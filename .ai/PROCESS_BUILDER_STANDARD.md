# Process Builder Standard

## Goal
Every new managed process must be traceable, readable, and safe to extend.

## Required comment headers
- PROCESS NAME
- PURPOSE
- TRIGGER
- CONDITIONS
- FAILSAFE
- ROLLBACK

## Rules
- New process code must include a top-of-block comment describing intent.
- New process definitions must carry `commentPolicy.required = true`.
- Review patch notes and logs before changing trigger conditions.
- Do not add side effects to a process step without a failsafe note.
- If a process touches setup, reset, messaging, or permissions, document rollback impact.

## V202 — failure-semantics labels (audit §28)
The `ROLLBACK` header is kept (pre-commit requires it), but its content MUST state which of these applies:
- **ABORT / CONTAINMENT** — stop new side effects and log. Already-created resources remain. This is the default for
  Process Builder presets.
- **COMPENSATE** — each completed step lists the explicit undo action that will be run (resource journal required).
- **ROLLBACK** — only when every side effect is transactional (e.g. a single DB transaction).

## Scope
- Governed by these headers: process definitions created through `processBuilderService` (`data/processBuilder.json`).
- `src/services/flowDefinitions.js` workflows are governed by `workflowRegistryService` metadata (owner, trigger,
  priority) and the file-level step comments; they are NOT required to carry the six per-process headers.
- League automation (`src/league/advanceEngine.js`) documents its failure transitions in code: RETRY_WAIT,
  HOLD, RECOVERY_REQUIRED. Discord projection failures never roll back committed league state.
