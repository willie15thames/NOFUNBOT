/*
 * NAVIGATION HEADER
 * FILE: src/services/naturalActionPlannerService.js
 * LAYER: Service layer
 * PURPOSE: Deterministic natural-language planning for common commissioner actions. Resolve intent and entities first,
 *          ask only for genuinely ambiguous details, then call the SAME domain service used by slash commands.
 * IMPORTANT: This is not a second command system. It is an intent/entity adapter into existing services.
 */
'use strict';

const activeLeagueService = require('./activeLeagueService');
const { TEAM_SLANG } = require('../config/teams');

const PENDING_TTL_MS = Math.max(1, Math.min(30, Number(process.env.BOT_NL_PENDING_MINUTES || 5) || 5)) * 60 * 1000;
const _pending = new Map();
const MAX_PENDING = Math.max(50, Math.min(2000, Number(process.env.BOT_NL_PENDING_MAX || 500) || 500));
const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function _pendingKey(message) { return `${message.guild?.id || 'g'}:${message.channel?.id || 'c'}:${message.author?.id || 'u'}`; }
function _prune(now = Date.now()) { for (const [k,v] of _pending.entries()) if (now > v.expiresAt) _pending.delete(k); }
function _stripBotMention(message) {
  const botId = message.client?.user?.id;
  let s = String(message.content || '');
  if (botId) s = s.replace(new RegExp(`<@!?${botId}>`, 'g'), ' ');
  return s.replace(/\s+/g, ' ').trim();
}
function parseTeamAssignment(text) {
  const raw = String(text || '').trim();
  const patterns = [
    /^(?:please\s+)?(?:put|place|assign|add|move)\s+(.+?)\s+(?:on|to|onto|with)\s+(?:the\s+)?(.+?)\s*$/i,
    /^(?:please\s+)?(?:make)\s+(.+?)\s+(?:the\s+)?(.+?)(?:\s+owner)?\s*$/i,
    /^(?:please\s+)?(?:give)\s+(.+?)\s+(?:the\s+)?(.+?)\s*$/i,
  ];
  for (const rx of patterns) {
    const m = raw.match(rx);
    if (m) return { intent: 'assign_team', memberQuery: m[1].trim(), teamQuery: m[2].trim() };
  }
  return null;
}
function _memberText(member) {
  return [member?.displayName, member?.user?.globalName, member?.user?.username, member?.user?.tag].filter(Boolean).map(norm);
}
async function resolveMember(guild, query, mentionedUsers = null) {
  const q = String(query || '').trim();
  const mention = q.match(/<@!?(\d{15,22})>/);
  if (mention) {
    const m = await guild.members.fetch(mention[1]).catch(() => guild.members.cache?.get?.(mention[1]) || null);
    return m ? { status: 'one', member: m } : { status: 'none', query: q };
  }
  // If the sentence contains a real mention, trust Discord's resolved user even after text cleanup.
  const mentionUsers = mentionedUsers ? [...mentionedUsers.values()].filter(u => String(u.id) !== String(guild.members?.me?.id)) : [];
  if (mentionUsers.length === 1 && /^@?member$/i.test(q) === false) {
    const exactMentionName = mentionUsers.find(u => [u.username, u.globalName].filter(Boolean).some(n => norm(n) === norm(q.replace(/^@/, ''))));
    if (exactMentionName) {
      const m = await guild.members.fetch(exactMentionName.id).catch(() => guild.members.cache?.get?.(exactMentionName.id) || null);
      if (m) return { status: 'one', member: m };
    }
  }
  const needle = norm(q.replace(/^@/, ''));
  if (!needle) return { status: 'none', query: q };
  // Fetching the full member list can be expensive on large servers; search cache first, then use Discord search when available.
  let pool = [...(guild.members?.cache?.values?.() || [])];
  let matches = pool.filter(m => _memberText(m).some(x => x === needle));
  if (!matches.length) matches = pool.filter(m => _memberText(m).some(x => x.startsWith(needle) || x.includes(needle)));
  if (!matches.length && guild.members?.search) {
    const found = await guild.members.search({ query: q.replace(/^@/, ''), limit: 10 }).catch(() => null);
    if (found) {
      pool = [...found.values()];
      matches = pool.filter(m => _memberText(m).some(x => x === needle));
      if (!matches.length) matches = pool.filter(m => _memberText(m).some(x => x.includes(needle)));
    }
  }
  const unique = [...new Map(matches.map(m => [String(m.id), m])).values()];
  if (unique.length === 1) return { status: 'one', member: unique[0] };
  if (unique.length > 1) return { status: 'many', members: unique.slice(0, 6), query: q };
  return { status: 'none', query: q };
}
function _resolveTeamAlias(q) {
  const raw = String(q || '').trim();
  return TEAM_SLANG[String(raw).toLowerCase()] || raw;
}
function findTeamCandidates(state, teamQuery, leagueHint = null) {
  const needle = norm(_resolveTeamAlias(teamQuery));
  if (!needle) return [];
  const leagueNeedle = norm(leagueHint);
  const rows = (state.openTeamRegistry || []).filter(e => {
    const names = [e.baseTeam, e.displayTeam].map(norm);
    const teamMatch = names.some(n => n === needle) || names.some(n => n.includes(needle) || needle.includes(n));
    if (!teamMatch) return false;
    if (!leagueNeedle) return true;
    const lg = activeLeagueService.getLeague(e.leagueId) || { id: e.leagueId, leagueName: e.leagueName || e.leagueId };
    return [lg.id, lg.leagueName].map(norm).some(n => n && (n === leagueNeedle || n.includes(leagueNeedle) || leagueNeedle.includes(n)));
  });
  const exact = rows.filter(e => [e.baseTeam, e.displayTeam].map(norm).includes(needle));
  return exact.length ? exact : rows;
}
function _leagueLabel(entry) {
  const lg = activeLeagueService.getLeague(entry.leagueId);
  return lg?.leagueName || entry.leagueName || entry.leagueId || 'default league';
}
function _extractLeagueHint(text) {
  const raw = String(text || '').trim();
  let m = raw.match(/\b(?:in|for|league)\s+(.+?)\s*$/i);
  return m ? m[1].trim() : null;
}
function _savePending(message, payload) {
  _prune();
  while (_pending.size >= MAX_PENDING) _pending.delete(_pending.keys().next().value);
  _pending.set(_pendingKey(message), { ...payload, expiresAt: Date.now() + PENDING_TTL_MS });
}
function _takePending(message) { _prune(); return _pending.get(_pendingKey(message)) || null; }
function _clearPending(message) { _pending.delete(_pendingKey(message)); }
function _formatMemberChoices(ms) { return ms.map(m => `**${m.displayName || m.user?.username || m.id}**`).join(', '); }

async function tryHandleCommissionerMessage(message, { state, claimTeam = null } = {}) {
  if (!message?.guild || !state) return { handled: false };
  const text = _stripBotMention(message);
  let parsed = parseTeamAssignment(text);
  const pending = _takePending(message);
  if (parsed) _clearPending(message); // a new full request replaces any older clarification plan

  if (!parsed && pending?.intent === 'assign_team') {
    // Short explicit-mention follow-ups resolve only the field we previously asked for.
    const hint = text.replace(/^(?:use|pick|the|league|team|member)\s+/i, '').trim();
    if (hint) {
      parsed = { ...pending, resumed: true };
      if (pending.awaiting === 'league') parsed.leagueHint = hint;
      else if (pending.awaiting === 'team') parsed.teamQuery = hint;
      else if (pending.awaiting === 'member') {
        const mentioned = message.mentions?.users ? [...message.mentions.users.values()].filter(u => String(u.id) !== String(message.client?.user?.id)) : [];
        if (mentioned.length === 1) parsed.memberId = mentioned[0].id;
        else parsed.memberQuery = hint;
      } else parsed.leagueHint = hint;
    }
  }
  if (!parsed) return { handled: false };

  // Allow natural explicit scoping such as "put Paul on the Ravens in Sunday League".
  // Keep the team phrase clean so league words do not poison team matching.
  if (!parsed.leagueHint && parsed.teamQuery) {
    const scoped = String(parsed.teamQuery).match(/^(.+?)\s+(?:in|for)\s+(.+?)\s*$/i);
    if (scoped) {
      parsed.teamQuery = scoped[1].trim();
      parsed.leagueHint = scoped[2].trim();
    }
  }

  let memberResult;
  const effectiveMemberId = parsed.memberId || (parsed.resumed ? pending?.memberId : null);
  if (effectiveMemberId) {
    memberResult = { status: 'one', member: await message.guild.members.fetch(effectiveMemberId).catch(() => message.guild.members.cache?.get?.(effectiveMemberId) || null) };
  } else if (/^(?:me|myself|i)$/i.test(String(parsed.memberQuery || '').trim())) {
    memberResult = { status: 'one', member: message.member || await message.guild.members.fetch(message.author.id).catch(() => null) };
  } else {
    memberResult = await resolveMember(message.guild, parsed.memberQuery, message.mentions?.users);
  }
  if (memberResult.status === 'none' || !memberResult.member) {
    _savePending(message, { ...parsed, intent: 'assign_team', awaiting: 'member' });
    return { handled: true, reply: `I couldn't confidently find **${parsed.memberQuery}** in this server. @mention the member or give me their exact server display name.` };
  }
  if (memberResult.status === 'many') {
    _savePending(message, { ...parsed, intent: 'assign_team', awaiting: 'member' });
    return { handled: true, reply: `I found more than one member matching **${parsed.memberQuery}**: ${_formatMemberChoices(memberResult.members)}. @mention the one you mean.` };
  }

  const member = memberResult.member;
  const explicitLeagueHint = parsed.leagueHint || _extractLeagueHint(text);
  const candidates = findTeamCandidates(state, parsed.teamQuery, explicitLeagueHint);
  if (!candidates.length) {
    _savePending(message, { ...parsed, intent: 'assign_team', memberId: member.id, awaiting: 'team' });
    return { handled: true, reply: `I couldn't find a **${parsed.teamQuery}** team slot${explicitLeagueHint ? ` in **${explicitLeagueHint}**` : ''}. Tell me the exact team or league name and I'll keep the assignment in context.` };
  }

  // Ambiguity is based on valid team candidates, not total league count.
  const byLeague = new Map();
  for (const e of candidates) byLeague.set(String(e.leagueId || 'legacy'), e);
  if (byLeague.size > 1 && !explicitLeagueHint) {
    _savePending(message, { ...parsed, intent: 'assign_team', memberId: member.id, awaiting: 'league' });
    const leagues = [...byLeague.values()].map(_leagueLabel);
    return { handled: true, reply: `I found **${parsed.teamQuery}** in more than one league: ${leagues.map(x => `**${x}**`).join(', ')}. Which league do you mean?` };
  }
  if (candidates.length > 1) {
    _savePending(message, { ...parsed, intent: 'assign_team', memberId: member.id, awaiting: 'team' });
    return { handled: true, reply: `I found multiple team slots matching **${parsed.teamQuery}**. Give me the exact team display name or league so I don't touch the wrong slot.` };
  }

  const entry = candidates[0];
  const claim = claimTeam || require('./openTeamsService').claimTeam;
  const result = await claim(message.guild, member, entry.baseTeam || entry.displayTeam, { leagueId: entry.leagueId });
  if (!result?.success) return { handled: true, reply: `I found the right team, but I couldn't assign it: ${result?.reason || 'unknown error'}` };
  _clearPending(message);
  return { handled: true, executed: true, reply: `✅ ${member} now owns **${result.entry.displayTeam}** in **${_leagueLabel(result.entry)}**.` };
}


function _providerKeyFromWords(value) {
  const n = norm(value);
  if (!n) return null;
  if (/(?:neon|neonsportz)/.test(n)) return 'neonsportz';
  if (/(?:companion direct|madden companion direct|companion export)/.test(n)) return 'companion_export';
  if (/(?:custom endpoint|custom url|custom)/.test(n)) return 'custom_endpoint';
  if (/(?:legacy madden|madden json|madden endpoint)/.test(n)) return 'madden_companion';
  if (/(?:2k|nba 2k)/.test(n)) return 'nba2k_companion';
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
}

function parseCatalogAction(text) {
  const raw = String(text || '').trim();
  let m;

  // Read/status actions.
  if (/^(?:show|give|what(?:'s| is)|check)?\s*(?:the\s*)?(?:league\s*)?(?:status|automation status)\??$/i.test(raw)) return { type:'league_status' };
  if (/^(?:refresh|update|repost)\s+(?:the\s+)?open[ -]?teams(?:\s+board)?$/i.test(raw)) return { type:'refresh_open_teams' };
  if (/^(?:show|list|check)\s+(?:the\s+)?ban(?:ned)?\s+list$/i.test(raw)) return { type:'ban_list' };
  if (/^(?:show|check|what(?:'s| is))\s+(?:the\s+)?(?:provider|live sync|data source)(?:\s+status)?\??$/i.test(raw)) return { type:'provider_status' };
  if (/^(?:sync|refresh)\s+(?:the\s+)?(?:league\s+)?(?:data\s+)?(?:now)?$/i.test(raw) || /^(?:run\s+)?live\s+sync(?:\s+now)?$/i.test(raw)) return { type:'provider_sync_now' };
  if ((m = raw.match(/^(?:test|check)\s+(.+?)\s+(?:provider\s+)?connection$/i))) return { type:'provider_test_connection', provider:_providerKeyFromWords(m[1]) };
  if ((m = raw.match(/^(?:activate|use|switch to)\s+(.+?)\s+(?:as\s+)?(?:the\s+)?(?:provider|data source)?$/i))) {
    const provider=_providerKeyFromWords(m[1]); if(provider) return { type:'provider_activate_connection', provider };
  }
  if ((m = raw.match(/^(?:disconnect|remove)\s+(.+?)\s+(?:provider|connection)?$/i))) return { type:'provider_disconnect', provider:_providerKeyFromWords(m[1]) };
  if ((m = raw.match(/^(?:reconnect|reconnect to)\s+(.+?)(?:\s+provider)?$/i))) return { type:'provider_reconnect', provider:_providerKeyFromWords(m[1]) };
  if ((m = raw.match(/^(?:fallback|fall back|switch)\s+(?:to\s+)?manual(?:\s+for\s+(.+))?$/i))) return { type:'provider_manual_fallback', provider:_providerKeyFromWords(m[1] || 'custom_endpoint') };

  // League/week workflow actions.
  if ((m = raw.match(/^(?:set|make|change)\s+(?:the\s+)?hub\s+week\s+(?:to\s+)?(\d{1,2})$/i))) return { type:'set_hub_week', week:Number(m[1]) };
  if (/^(?:release|publish)\s+(?:the\s+)?(?:current\s+)?week$/i.test(raw)) return { type:'release_week' };
  if (/^(?:check|preview|dry run|test)\s+(?:the\s+)?(?:league\s+)?advance$/i.test(raw)) return { type:'request_league_advance', dryRun:true };
  if (/^(?:advance|advance the league|request league advance)$/i.test(raw)) return { type:'request_league_advance', dryRun:false };

  // Automation policy actions.
  if ((m = raw.match(/^(?:turn|set)\s+(?:league\s+)?automation\s+(on|off)$/i))) return { type:'set_automation_policy', enabled:m[1].toLowerCase()==='on' };
  if ((m = raw.match(/^(?:set|change)\s+(?:the\s+)?automation\s+interval\s+(?:to\s+)?(\d{1,3})\s*(?:h|hr|hrs|hours)?$/i))) return { type:'set_automation_policy', intervalHours:Number(m[1]) };
  if ((m = raw.match(/^(?:turn|set)\s+(?:automation\s+)?shadow(?:\s+mode)?\s+(on|off)$/i))) return { type:'set_automation_policy', shadowMode:m[1].toLowerCase()==='on' };
  if ((m = raw.match(/^(?:block|stop)\s+(?:league\s+)?advance\s+(?:when|if)\s+(?:a\s+)?game\s+is\s+active\s+(on|off)$/i))) return { type:'set_automation_policy', blockOnActiveGame:m[1].toLowerCase()==='on' };
  if ((m = raw.match(/^(?:require|make)\s+all\s+games\s+(?:be\s+)?final\s+(?:before\s+advance\s+)?(on|off)$/i))) return { type:'set_automation_policy', requireAllGamesFinal:m[1].toLowerCase()==='on' };

  // Team lifecycle. Optional league phrase is preserved for the resolver.
  if ((m = raw.match(/^(?:release|free|drop|open up)\s+(?:the\s+)?(.+?)(?:\s+team)?(?:\s+(?:in|for)\s+(.+?))?$/i))) {
    if (!/^week\b/i.test(m[1])) return { type:'release_team', teamName:m[1].trim(), ...(m[2]?{leagueHint:m[2].trim()}:{}) };
  }

  // Discord structure actions. More-specific role/category grammar precedes generic channel grammar.
  if ((m = raw.match(/^(?:create|make|add)\s+(?:a\s+)?role\s+(?:called\s+)?(.+?)$/i))) return { type:'create_role', name:m[1].trim() };
  if ((m = raw.match(/^(?:rename|change)\s+(?:the\s+)?role\s+(.+?)\s+(?:to|into)\s+(.+?)$/i))) return { type:'rename_role', oldName:m[1].trim(), newName:m[2].trim() };
  if ((m = raw.match(/^(?:set|change|make)\s+(?:the\s+)?role\s+(.+?)\s+(?:color|colour)\s+(?:to|as)\s+(#?[0-9a-f]{6})$/i))) return { type:'set_role_color', name:m[1].trim(), color:m[2].trim() };
  if ((m = raw.match(/^(?:rename|change)\s+(?:the\s+)?category\s+(.+?)\s+(?:to|into)\s+(.+?)$/i))) return { type:'rename_category', oldName:m[1].trim(), newName:m[2].trim() };
  if ((m = raw.match(/^(?:create|make|add)\s+(?:a\s+)?(?:channel|room)\s+(?:called\s+)?#?([^\s]+)(?:\s+in\s+(?:the\s+)?(.+?))?$/i))) return { type:'create_channel', name:m[1].trim(), ...(m[2]?{category:m[2].trim()}:{}) };
  if ((m = raw.match(/^(?:rename|change)\s+(?:the\s+)?(?:channel\s+)?#?(.+?)\s+(?:to|into)\s+#?(.+?)$/i))) return { type:'rename_channel', oldName:m[1].trim(), newName:m[2].trim() };
  if ((m = raw.match(/^(?:delete|remove)\s+(?:the\s+)?(?:channel|room)\s+#?(.+?)$/i))) return { type:'delete_channel', name:m[1].trim() };
  if ((m = raw.match(/^(?:set|change)\s+(?:the\s+)?(?:topic|description)\s+(?:for|of|on)\s+#?(.+?)\s+(?:to|as)\s+(.+)$/i))) return { type:'set_channel_topic', name:m[1].trim(), topic:m[2].trim() };
  if ((m = raw.match(/^(?:post|send|say)\s+(.+?)\s+(?:in|to)\s+#?([a-z0-9_-]+)$/i))) return { type:'post_message', text:m[1].trim().replace(/^['"]|['"]$/g,''), channelName:m[2].trim() };

  // Moderation and rules actions.
  if ((m = raw.match(/^(?:unban|lift the ban on)\s+<@!?(\d{15,22})>$/i))) return { type:'unban_user', userId:m[1] };
  if ((m = raw.match(/^(?:ban)\s+<@!?(\d{15,22})>(?:\s+(?:for|because)\s+(.+))?$/i))) return { type:'ban_user', userId:m[1], ...(m[2]?{reason:m[2].trim()}:{}) };
  if ((m = raw.match(/^(?:replace|change)\s+(?:the\s+)?rule\s+['"]?(.+?)['"]?\s+(?:with|to)\s+['"]?(.+?)['"]?$/i))) return { type:'update_rules', oldText:m[1].trim(), newText:m[2].trim() };
  if ((m = raw.match(/^(?:append|add)\s+(?:to\s+)?(?:the\s+)?rules(?:\s+under\s+(.+?))?\s*[:\-]\s*(.+)$/i))) return { type:'update_rules', newText:m[2].trim(), ...(m[1]?{section:m[1].trim()}:{}) };
  return null;
}
function planCatalogActionFromMessage(message, { state = null } = {}) {
  const text = _stripBotMention(message);
  let action = parseCatalogAction(text);
  const pending = _takePending(message);
  if (action) _clearPending(message); // every new complete request supersedes an older clarification

  // Smooth follow-up for an ambiguous team release. The member still has to explicitly @mention the bot
  // because this function is only reached behind the hard mention gate in commissionerHandler.
  if (!action && pending?.intent === 'release_team') {
    const hint = text.replace(/^(?:use|pick|the|league)\s+/i, '').trim();
    if (hint) action = { type:'release_team', teamName:pending.teamName, leagueHint:hint, resumed:true };
  }
  if (!action) return { handled:false };

  if (action.type === 'release_team' && state) {
    const candidates = findTeamCandidates(state, action.teamName, action.leagueHint).filter(e => !e.isOpen || e.ownerId);
    if (!candidates.length) {
      return { handled:true, reply:`I couldn't find a claimed **${action.teamName}** team${action.leagueHint ? ` in **${action.leagueHint}**` : ''}. Give me the exact team or league and I won't guess.` };
    }
    const byLeague = new Map(candidates.map(e => [String(e.leagueId || 'legacy'), e]));
    if (byLeague.size > 1 && !action.leagueHint) {
      _savePending(message, { intent:'release_team', teamName:action.teamName, awaiting:'league' });
      const leagues = [...byLeague.values()].map(_leagueLabel);
      return { handled:true, reply:`I found a claimed **${action.teamName}** in more than one league: ${leagues.map(x => `**${x}**`).join(', ')}. Which league do you mean?` };
    }
    if (candidates.length > 1) {
      return { handled:true, reply:`I found multiple claimed team slots matching **${action.teamName}**. Give me the exact team display name so I don't release the wrong owner.` };
    }
    const entry = candidates[0];
    action = { type:'release_team', teamName:`${entry.baseTeam || entry.displayTeam}::${entry.leagueId || ''}` };
    _clearPending(message);
  }
  return { handled:true, action };
}

const _pendingSweepTimer = setInterval(() => _prune(), 60 * 1000);
_pendingSweepTimer.unref?.();
function clearPending() { const n = _pending.size; _pending.clear(); return n; }
module.exports = { parseTeamAssignment, parseCatalogAction, planCatalogActionFromMessage, resolveMember, findTeamCandidates, tryHandleCommissionerMessage, clearPending, PENDING_TTL_MS };
