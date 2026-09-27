# Dedup Architecture

## Layer Hierarchy (evaluated in order, outermost first)

```
┌──────────────────────────────────────────────────────────────┐
│ L1  eventClaimService           (Redis / local Map)          │
│     Scope: per Discord event (messageCreate, messageUpdate,  │
│            interactionCreate). Key = guildId + eventId.      │
│     TTL: 30s. Single-consumer across instances.              │
├──────────────────────────────────────────────────────────────┤
│ L2  _messageCreateInFlight      (local Map in index.js)      │
│     Scope: per messageCreate. Set immediately after L1 claim.│
│     Purpose: Prevents messageUpdate from re-entering AI      │
│     routing while messageCreate is still processing.         │
│     TTL: 60s. Single-instance only.                          │
├──────────────────────────────────────────────────────────────┤
│ L3  personaArbiterService       (decision engine)            │
│     Scope: per message. Evaluates all candidate personas.    │
│     Guarantees: exactly ONE winner or no-reply.              │
│     Not a lock — a routing decision. Logged for audit.       │
├──────────────────────────────────────────────────────────────┤
│ L4  responseLifecycleService    (wraps L5 internally)        │
│     Scope: per message + persona. Standard pipeline:         │
│     validate → claim → route → respond → settle → log.      │
│     Claims via L5 (responseGuard). Emits to observability.   │
├──────────────────────────────────────────────────────────────┤
│ L5  responseGuardService        (in-memory TTL Maps)         │
│     Scope: per message route + per message+scope response.   │
│     claimMessageRoute: one route per message (20s TTL)       │
│     claimMessageResponse: one response per message+scope     │
│     claimInteractionExecution: one exec per interaction      │
│     claimSend: fingerprint-based send dedup (4s TTL)         │
├──────────────────────────────────────────────────────────────┤
│ L6  Handler-internal dedup      (per-handler TTL Maps)       │
│     _wasAlreadyProcessed (member): 30s per msgId             │
│     _commAlreadyProcessed (comm): 30s per msgId              │
│     Purpose: Last-resort guard inside the handler itself.    │
├──────────────────────────────────────────────────────────────┤
│ L7  sendMessageService.claimSend (payload fingerprint)       │
│     Scope: per channel + payload content hash. 4s TTL.       │
│     Catches identical payloads sent to the same channel      │
│     within a short window, regardless of caller.             │
└──────────────────────────────────────────────────────────────┘
```

## Which layer catches which problem

| Problem                                    | Caught by |
|--------------------------------------------|-----------|
| Multi-instance processes same event         | L1 (Redis) |
| messageUpdate races messageCreate           | L2 |
| Both commissioner + member persona fire     | L3 |
| Same message enters lifecycle twice         | L4 → L5 |
| Rapid Discord retries of same interaction   | L5 |
| Handler called twice despite lifecycle      | L6 |
| Identical message content sent twice        | L7 |

## Future simplification

Once the lifecycle (L4) is proven stable across all paths (including interactions),
L5 direct calls and L6 handler-internal dedup can be evaluated for removal.
L1, L2, L3, L4, and L7 are the core necessary layers.

## V202 note — no new message-dedup layer
V202 adds no layer to the message/interaction dedup chain above. The following are persistence/concurrency
mechanisms, not message dedup, and must not be used as such:
- **Import idempotency** (`src/league/importRunService.js`): provider receipts deduped by delivery id / payload hash
  (+ one-way league-token tag). Prevents a retried webhook/export from being imported twice.
- **Result idempotency** (`src/league/gameResultService.js`): matchupKey + sourceRevision; corrections supersede.
- **Game-channel identity** (`gameSessionService` + `ensureGameChannel`): matchupKey find-or-create.
- **Advance lock** (`advanceEngine`): process single-flight + `guildLockService` + `eventClaimService.claim` (Redis SET NX
  when REDIS_URL is set) around each tick; provider control keyed by cycleId (`controlRequestedFor`).
- **AI confirmation** (`src/actions/confirmationService.js`): one-time, requester-bound tokens (TTL 10m, max 200).
The silent category dedup sweep (baseInitService) is now scoped: destructive only for categories touched in the current
build; everything else is report-only.

## V204 persistence transactions
criticalStore serializes space reservations, assignments, locks and lifetime source records with PostgreSQL transaction advisory locks. These are business-state concurrency controls; the existing message dedup hierarchy is unchanged. Lifetime correction keys supersede prior source values without deleting audit history.


## RC6 ownership updates

`gameResultService` commits through `lifetimeHistoryService.transaction` before rebuilding projections. Stream credits use durable message IDs in the lifetime transaction; manual adjustments use interaction IDs. `criticalStore.withExclusive` owns structural operation locks across router commands. Membership, community deletion and pending active removals keep repair intent until completion. Queue producers reuse a bounded connection/cache. See docs/RC6_DEPENDENCY_MAP.md and the RC6 deployment guide.
