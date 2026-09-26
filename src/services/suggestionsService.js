/*
 * NAVIGATION HEADER
 * FILE: src/services/suggestionsService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

async function _sendWebhook(text) {
  const url = process.env.SUGGESTIONS_WEBHOOK_URL || '';
  if (!url) return { ok: false, reason: 'webhook_not_configured' };
  // V202 (BUG-010): central intake — https only, no private destinations, timeout enforced.
  const { fetchExternal } = require('../utils/httpIntake');
  const res = await fetchExternal({ url, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), timeoutMs: 10000, maxBytes: 64 * 1024 });
  if (!res.ok) return { ok: false, reason: res.status ? `webhook_status_${res.status}` : `webhook_${res.reason}` };
  return { ok: true };
}

async function routeSuggestion({ guild, client, user, type, text, commissionerIds = [] }) {
  const payload = `Suggestion type: ${type}\nServer: ${guild?.name || 'Unknown'} (${guild?.id || 'n/a'})\nFrom: ${user?.tag || user?.username || user?.id} (${user?.id || 'n/a'})\n\n${text}`;

  if (type === 'server') {
    const uniqueIds = [...new Set((commissionerIds || []).filter(Boolean))];
    let sent = 0;
    let failed = 0;
    for (const id of uniqueIds) {
      try {
        const target = await client.users.fetch(id);
        await target.send(`📬 NOFUNLEAGUE server suggestion\n\n${payload}`);
        sent++;
      } catch {
        failed++;
      }
    }
    return { ok: true, sent, failed, route: 'staff_dm' };
  }

  const hook = await _sendWebhook(`🤖 NOFUNLEAGUE bot suggestion\n\n${payload}`);
  if (hook.ok) return { ok: true, route: 'webhook' };
  return { ok: false, route: 'webhook', reason: hook.reason || 'delivery_failed' };
}

module.exports = {
  routeSuggestion,
};
