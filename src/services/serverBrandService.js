/*
 * NAVIGATION HEADER
 * FILE: src/services/serverBrandService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
function resolveServerName(source, fallback = 'this server') {
  if (!source) return fallback;
  if (typeof source === 'string') return String(source).trim() || fallback;
  if (source.name) return String(source.name).trim() || fallback;
  if (source.guild && source.guild.name) return String(source.guild.name).trim() || fallback;
  if (source.guildName) return String(source.guildName).trim() || fallback;
  return fallback;
}
function replaceBrand(text, source, fallback = 'this server') {
  const serverName = resolveServerName(source, fallback);
  return String(text || '').replace(/NOFUNLEAGUE|COMMISHAI/gi, serverName);
}
module.exports = { resolveServerName, replaceBrand };
