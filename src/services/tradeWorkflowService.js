/*
 * NAVIGATION HEADER
 * FILE: src/services/tradeWorkflowService.js
 * LAYER: Domain service
 * PURPOSE: Single owner for durable trade proposal/decision state. Slash/button/natural-language adapters must
 *          call this service instead of mutating state.pendingTrades directly.
 */
'use strict';

const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function _leagueLabel(state, id) {
  const row = state?.activeLeagues?.get?.(String(id));
  return row?.leagueName || row?.name || id || 'default league';
}

function _candidates(state, name, leagueId) {
  const needle = norm(name);
  if (!needle) return [];
  const pool = Array.isArray(state?.openTeamRegistry) ? state.openTeamRegistry : [];
  const rows = pool.filter(e => {
    if (leagueId != null && String(e.leagueId || '') !== String(leagueId)) return false;
    const names = [e.baseTeam, e.displayTeam].map(norm).filter(Boolean);
    return names.some(n => n === needle) || names.some(n => n.includes(needle) || needle.includes(n));
  });
  const exact = rows.filter(e => [e.baseTeam, e.displayTeam].map(norm).includes(needle));
  return exact.length ? exact : rows;
}

function _resolveOne(state, name, leagueId) {
  const rows = _candidates(state, name, leagueId);
  if (!rows.length) return { ok:false, reason:`team-not-found:${name}` };
  const leagues = new Set(rows.map(r => String(r.leagueId || 'legacy')));
  if (leagues.size > 1 && !leagueId) return { ok:false, reason:'league-ambiguous', leagues:[...leagues].map(id => _leagueLabel(state, id)) };
  if (rows.length > 1) return { ok:false, reason:`team-ambiguous:${name}` };
  return { ok:true, entry:rows[0] };
}

function _persist(state) {
  try { state?.persistPendingState?.(); } catch {}
}

function propose(state, { proposerId, yourTeam, targetTeam, details, leagueId = null } = {}) {
  if (!state?.pendingTrades?.set) return { ok:false, reason:'trade-state-unavailable' };
  if (!proposerId) return { ok:false, reason:'proposer-required' };
  if (!String(details || '').trim()) return { ok:false, reason:'trade-details-required' };
  const yours = _resolveOne(state, yourTeam, leagueId);
  if (!yours.ok) return yours;
  const resolvedLeague = yours.entry.leagueId || leagueId || null;
  const target = _resolveOne(state, targetTeam, resolvedLeague);
  if (!target.ok) return target;
  if (String(yours.entry.leagueId || '') !== String(target.entry.leagueId || '')) return { ok:false, reason:'teams-must-share-league' };
  if (norm(yours.entry.baseTeam) === norm(target.entry.baseTeam)) return { ok:false, reason:'cannot-trade-with-same-team' };
  if (yours.entry.ownerId && String(yours.entry.ownerId) !== String(proposerId)) return { ok:false, reason:'proposer-does-not-own-source-team' };
  if (!yours.entry.ownerId) return { ok:false, reason:'source-team-is-unclaimed' };
  if (!target.entry.ownerId) return { ok:false, reason:'target-team-is-unclaimed' };

  const tradeId = state.nextTradeId ? state.nextTradeId() : `TRADE-${Date.now()}`;
  const trade = {
    tradeId,
    leagueId: yours.entry.leagueId || null,
    proposerId:String(proposerId),
    proposerTeam:yours.entry.displayTeam || yours.entry.baseTeam,
    proposerBase:yours.entry.baseTeam || yours.entry.displayTeam,
    targetTeam:target.entry.displayTeam || target.entry.baseTeam,
    targetBase:target.entry.baseTeam || target.entry.displayTeam,
    targetOwnerId:target.entry.ownerId ? String(target.entry.ownerId) : null,
    details:String(details).trim().slice(0, 1800),
    createdAt:Date.now(),
    status:'pending',
  };
  state.pendingTrades.set(tradeId, trade);
  _persist(state);
  return { ok:true, trade };
}

function decide(state, tradeId, { approved, actorId } = {}) {
  const id = String(tradeId || '').trim();
  const trade = state?.pendingTrades?.get?.(id);
  if (!trade) return { ok:false, reason:'already-processed-or-not-found' };
  state.pendingTrades.delete(id);
  const decided = { ...trade, status:approved ? 'approved' : 'declined', decidedAt:Date.now(), decidedBy:actorId ? String(actorId) : null };
  _persist(state);
  return { ok:true, trade:decided };
}

function get(state, tradeId) { return state?.pendingTrades?.get?.(String(tradeId || '')) || null; }
function list(state) { return [...(state?.pendingTrades?.values?.() || [])]; }

module.exports = { propose, decide, get, list, _candidates };
