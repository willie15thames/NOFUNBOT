/*
 * NAVIGATION HEADER
 * FILE: src/services/leagueSetupService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

// src/services/leagueSetupService.js
// Multi-game league wizard + Pro-Am custom leagues.
// Partial season = 75% of full. Shared rules across all leagues.
// Pro-Am: 8 or 10 teams, fully custom, logo upload, generated schedule, live standings.

const {
  ChannelType, PermissionsBitField, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { makeLogger }                   = require('../utils/logger');
const { saveJsonDebounced, loadJson }  = require('../storage/jsonStore');
const { COMM_ROLE }                    = require('../config/env');
const activeLeagueService                = require('./activeLeagueService');
const { buildMemberGuideEmbed }          = require('./rulesGuideService');
const { seedLeagueTeams }                = require('./teamSeedService');
const stateRef                           = require('../state');
const { resolveServerName }             = require('./serverBrandService');
const log = makeLogger('leagueSetup');
const { getStaffRoles: getConfiguredStaffRoles } = require('./accessPolicyService');

// ── Shared rules that apply to ALL leagues (adapted per sport) ─
const SHARED_RULES = {
  madden: `
**UNIVERSAL NOFUNLEAGUE RULES — MADDEN**
• Difficulty: All-Madden | Quarters: 4 minutes | Advance window: 48 hours
• No chew clock before the 2-minute warning in the 4th quarter
• No nano blitzing, no glitch exploits (Sim League: strictly enforced)
• All trades require commissioner approval. CPU trades need full green bar.
• 3 gameplay warnings = force loss. 3 close-app warnings = removal. 3 inactivity = removal.
• Cheating or score manipulation = AUTOMATIC FORCE LOSS. No exceptions.
• Stream rewards: 8 streams = Superstar dev. 16 = Dev Upgrade or Age Reset.
• Every stream = +2 attr boost (max 4 attrs per week from streams + games combined).
• POTW: 5 per week, each = +2 non-physical attribute (UNLIMITED, excluded from limit).
• Yearly & Super Bowl awards are UNLIMITED and excluded from the weekly attr limit.
• Boosts do NOT carry over week to week.
• No physical attribute boosts: Speed, Agility, Strength, Acceleration, Stamina, Toughness, Injury.
`,
  nba2k: `
**UNIVERSAL NOFUNLEAGUE RULES — NBA 2K**
• Difficulty: Hall of Fame | Quarter length: 8 minutes | Advance window: 48 hours
• No cheese: no full-court press every possession, no 5-out spam, no glitch exploits
• Trades require commissioner approval. No trade abuse.
• 3 gameplay warnings = forfeit. 3 disconnect warnings = removal. 3 inactivity = removal.
• Quitting mid-game (not a crash) = automatic forfeit. No exceptions.
• Stream rewards: 8 streams = Superstar badge upgrade. 16 = Dev Upgrade or Age Reset.
• POTW: Offensive and Defensive weekly. Each = +1 badge upgrade or attribute boost.
• Weekly & Yearly awards are UNLIMITED and excluded from the weekly attr limit.
• Boosts do NOT carry over week to week.
• No cheese builds: no sliders abuse, no unrealistic lineup stacking against rules.
`,
  ncaa: `
**UNIVERSAL NOFUNLEAGUE RULES — NCAA CFB**
• Difficulty: Heisman | Quarter length: 8 minutes | Advance window: 48 hours
• No nano blitzing, no glitch plays, realistic sim-style offense required
• Recruiting: no poaching from other members' pipelines after mutual targeting is set
• Transfers: all portal activity must be announced in #transfer-portal within 24hrs
• 3 gameplay warnings = force loss. 3 inactivity warnings = removal.
• Forfeit = automatic loss counted in standings. No exceptions.
• Recruiting violations = -10 points penalty and loss of 2 scholarship offers.
`,
  proam: `
**UNIVERSAL NOFUNLEAGUE RULES — PRO-AM**
• Custom league. All teams created and named by members.
• Games played on mutually agreed-upon schedule within the 48-hour advance window.
• Score must be posted in #game-results by the winner within 2 hours of game completion.
• One forfeit warning. Second forfeit = removal from league and team opened.
• Standings updated automatically after each result. PA/PF tracked for tiebreakers.
• Trades allowed only if both team owners agree AND commissioner approves.
`,
};

// ── Season week calculator ────────────────────────────────────
// half for football = 10 games. partial = 75% (rounded to even).
const MIN_MEMBERS_TO_START = 15; // Minimum human members before a season can begin


function makeCustomSmallLeague({ game, id, label, description, emoji, color, teamCount, scheduleGames, formatLabel }) {
  const noun = game === 'nba2k' ? 'PRO-AM' : game === 'ncaa' ? 'CFB CUSTOM' : 'CUSTOM MADDEN';
  return {
    game, id, label, description, emoji, color,
    fullWeeks: scheduleGames,
    scheduleGames,
    teamCount,
    isCustom: true,
    isTeamBasedDynamicNick: true,
    playoffsNoByes: true,
    playoffTeams: teamCount <= 8 ? 4 : teamCount <= 10 ? 6 : 8,
    formatLabel: formatLabel || null,
    categories: [
      { name: `🏆 ─── ${noun} ───`, channels: ['announcements','rules','server-guide','open-teams','general'] },
      { name: '📊 ─── STANDINGS ───', channels: ['standings','schedule','game-results','scoreboard','seedings'] },
      { name: '📰 ─── NEWS ───', channels: ['league-news','highlights','stat-leaders'] },
      { name: '🔁 ─── TRANSACTIONS ───', channels: ['trade-block','transactions'] },
      { name: '🎥 ─── MEDIA ───', channels: ['livestreams','media-highlights'] },
      { name: '⚠️ ─── DISCIPLINE ───', channels: ['warnings-log','boot-log'] },
      { name: '🧠 ─── ADMIN ───', channels: ['commissioner-ai','admin-hq','commish-hub','scoresheets'], adminOnly: true },
      { name: '🎮 ─── GAME CHANNELS ───', channels: [] },
    ],
  };
}


function sharedCategoryNameFor(game, cat) {
  const raw = String(cat?.name || '').trim();
  if (raw) return raw;
  const key = String(cat?.key || '').toLowerCase();
  const sport = String(game || '').toLowerCase();
  const gameplayLabel = sport === 'nba2k' ? '🏀 ─── GAMEPLAY ───' : '🏈 ─── GAMEPLAY ───';
  const map = {
    info: '📢 ─── LEAGUE INFO ───',
    gameplay: gameplayLabel,
    rosters: '🔁 ─── ROSTERS ───',
    media: '🎥 ─── MEDIA ───',
    admin: '🧠 ─── STAFF HQ ───',
  };
  return map[key] || '📂 ─── LEAGUE SPACE ───';
}

function buildStaffOverwrites(guild, commRoleId, adminOnly = false) {
  const overwrites = [];

  if (adminOnly) overwrites.push({ id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] });

  const allow = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageMessages, PermissionsBitField.Flags.ManageChannels];
  if (commRoleId) overwrites.push({ id: commRoleId, allow });
  const staffRoles = getConfiguredStaffRoles(guild, { commRoleId, includeAdministrator: true, includeManageGuild: false, includeRoleNameFallback: false });
  for (const role of staffRoles.values()) { if (commRoleId && role.id === commRoleId) continue; overwrites.push({ id: role.id, allow }); }
  if (guild.members?.me?.id) overwrites.push({ id: guild.members.me.id, allow: [...allow, PermissionsBitField.Flags.ManageRoles] });
  return overwrites;
}


const READ_ONLY_CHANNEL_KEYS = new Set(['rules','announcements','server-guide','open-teams']);
function channelPermsForKey(guild, commRoleId, chKey, adminOnly = false) {
  const overwrites = buildStaffOverwrites(guild, commRoleId, adminOnly);
  if (READ_ONLY_CHANNEL_KEYS.has(chKey)) {
    overwrites.push({ id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.SendMessages] });
  }
  return overwrites;
}

function getSeasonWeeks(fullWeeks, type, game) {
  if (type === 'full')    return fullWeeks;
  if (type === 'half') {
    // Football-specific: half season = 10 games
    if (game === 'madden' || game === 'ncaa') return 10;
    return Math.ceil(fullWeeks / 2);
  }
  if (type === 'partial') return Math.ceil(fullWeeks * 0.75 / 2) * 2; // 75%, rounded to even
  return fullWeeks;
}

// ── League type definitions ───────────────────────────────────
const LEAGUE_TYPES = {

  // ═══════════════════ MADDEN ═══════════════════
  madden_franchise: {
    game: 'madden', id: 'madden_franchise',
    label: 'Madden Franchise (Standard)',
    description: 'Classic 32-team franchise. All-Madden, 4-min quarters, 48hr advance.',
    emoji: '🏈', color: 0x013369, fullWeeks: 18, teamCount: 32,
    categories: [
      { name: '📢 ─── LEAGUE INFO ───', channels: ['announcements','rules', 'server-guide','open-teams','general','nfl-chat'] },
      { name: '🏈 ─── GAMEPLAY ───',    channels: ['game-results','weekly-schedule','stat-leaders','player-of-week','rewards','dev-upgrades','superbowl'] },
      { name: '🔁 ─── TRADES ───',      channels: ['trade-block','pending-trades','accepted-trades','declined-trades','transactions'] },
      { name: '🎥 ─── MEDIA ───',       channels: ['livestreams','highlights'] },
      { name: '⚠️ ─── DISCIPLINE ───',  channels: ['force-wins','fair-sims','warnings-log','boot-log'] },
      { name: '🧠 ─── ADMIN HQ ───',    channels: ['commissioner-ai','admin-hq','commish-hub','scoresheets'], adminOnly: true },
      { name: '🎮 ─── WEEK GAMES ───',  channels: [] },
    ],
  },
  madden_fantasy: {
    game: 'madden', id: 'madden_fantasy',
    label: 'Madden Fantasy Draft',
    description: 'Full fantasy draft — any player, any team. All 32 slots drafted.',
    emoji: '🎯', color: 0x00b4d8, fullWeeks: 18, teamCount: 32,
    categories: [
      { name: '📢 ─── FANTASY LEAGUE ───', channels: ['announcements','rules', 'server-guide','open-teams','general'] },
      { name: '🎯 ─── DRAFT ───',           channels: ['draft-board','draft-chat'] },
      { name: '🏈 ─── GAMEPLAY ───',        channels: ['game-results','weekly-schedule','stat-leaders'] },
      { name: '🔁 ─── TRADES ───',          channels: ['trade-block','pending-trades','accepted-trades','transactions'] },
      { name: '🎥 ─── MEDIA ───',           channels: ['livestreams','highlights'] },
      { name: '⚠️ ─── DISCIPLINE ───',      channels: ['warnings-log','boot-log'] },
      { name: '🧠 ─── ADMIN ───',           channels: ['commissioner-ai','admin-hq','commish-hub','scoresheets'], adminOnly: true },
      { name: '🎮 ─── WEEK GAMES ───',      channels: [] },
    ],
  },
  madden_alltime: {
    game: 'madden', id: 'madden_alltime',
    label: 'Madden All-Time Greats',
    description: 'All-time greats squads only. Legends lineups, no current players.',
    emoji: '👑', color: 0xffd700, fullWeeks: 16, teamCount: 32,
    categories: [
      { name: '📢 ─── ALL-TIME GREATS ───', channels: ['announcements','rules', 'server-guide','legends-board','open-teams','general'] },
      { name: '🏈 ─── GAMEPLAY ───',         channels: ['game-results','weekly-schedule','stat-leaders','goat-debate'] },
      { name: '🔁 ─── ROSTERS ───',          channels: ['trade-block','transactions'] },
      { name: '🎥 ─── MEDIA ───',            channels: ['highlights'] },
      { name: '⚠️ ─── DISCIPLINE ───',       channels: ['warnings-log','boot-log'] },
      { name: '🧠 ─── ADMIN ───',            channels: ['commissioner-ai','admin-hq','commish-hub','scoresheets'], adminOnly: true },
      { name: '🎮 ─── WEEK GAMES ───',       channels: [] },
    ],
  },
  madden_sim: {
    game: 'madden', id: 'madden_sim',
    label: 'NFL Sim League (No Cheese)',
    description: 'Strict sim rules. No nano blitzes, realistic coaching only.',
    emoji: '🎲', color: 0x00274c, fullWeeks: 17, teamCount: 32,
    categories: [
      { name: '📢 ─── SIM LEAGUE ───',   channels: ['announcements','rules','open-teams','general'] },
      { name: '🏈 ─── GAMEPLAY ───',     channels: ['game-results','weekly-schedule','stat-leaders','playbook-check','replay-review'] },
      { name: '🔁 ─── ROSTERS ───',      channels: ['transactions'] },
      { name: '🎥 ─── MEDIA ───',        channels: ['highlights'] },
      { name: '⚠️ ─── DISCIPLINE ───',   channels: ['warnings-log','boot-log'] },
      { name: '🧠 ─── ADMIN ───',        channels: ['commissioner-ai','admin-hq','commish-hub','scoresheets'], adminOnly: true },
      { name: '🎮 ─── WEEK GAMES ───',   channels: [] },
    ],
  },
  madden_dual: {
    game: 'madden', id: 'madden_dual',
    label: 'Dual Division (AFC + NFC)',
    description: 'Two separate conferences with own standings, schedules, and seedings. Bot-managed custom league.',
    emoji: '🔥', color: 0xff4500, fullWeeks: 18, teamCount: 32,
    isCustom: true, // Bot creates and tracks everything — not a standard in-game franchise
    conferences: [
      { name: 'AFC', teams: ['Bills','Dolphins','Patriots','Jets','Ravens','Bengals','Browns','Steelers','Texans','Colts','Jaguars','Titans','Chiefs','Raiders','Chargers','Broncos'] },
      { name: 'NFC', teams: ['Cowboys','Eagles','Giants','Commanders','Bears','Lions','Packers','Vikings','Falcons','Panthers','Saints','Buccaneers','49ers','Seahawks','Rams','Cardinals'] },
    ],
    categories: [
      { name: '📢 ─── LEAGUE INFO ───',    channels: ['announcements','rules','open-teams','general'] },
      { name: '🔵 ─── AFC CONFERENCE ───', channels: ['afc-results','afc-schedule','afc-standings'] },
      { name: '🔴 ─── NFC CONFERENCE ───', channels: ['nfc-results','nfc-schedule','nfc-standings'] },
      { name: '🏆 ─── CHAMPIONSHIP ───',   channels: ['championship','seedings','playoff-bracket'] },
      { name: '🔁 ─── TRANSACTIONS ───',   channels: ['trade-block','transactions'] },
      { name: '🎥 ─── MEDIA ───',          channels: ['livestreams','highlights'] },
      { name: '⚠️ ─── DISCIPLINE ───',     channels: ['warnings-log','boot-log'] },
      { name: '🧠 ─── ADMIN ───',          channels: ['commissioner-ai','admin-hq','commish-hub','scoresheets'], adminOnly: true },
      { name: '🎮 ─── WEEK GAMES ───',     channels: [] },
    ],
  },

  // ═══════════════════ NBA 2K ═══════════════════
  nba2k_franchise: {
    game: 'nba2k', id: 'nba2k_franchise',
    label: 'NBA 2K MyNBA Franchise',
    description: 'Standard 30-team NBA franchise. HoF, trades, draft, free agency.',
    emoji: '🏀', color: 0xc9082a, fullWeeks: 82, teamCount: 30,
    categories: [
      { name: '📢 ─── LEAGUE INFO ───',  channels: ['announcements','rules','open-teams','general','nba-chat'] },
      { name: '🏀 ─── GAMEPLAY ───',     channels: ['game-results','weekly-schedule','stat-leaders','player-of-week','awards'] },
      { name: '🔁 ─── TRANSACTIONS ───', channels: ['trade-block','pending-trades','accepted-trades','transactions','draft-board','free-agency'] },
      { name: '🎥 ─── MEDIA ───',        channels: ['highlights','livestreams'] },
      { name: '⚠️ ─── DISCIPLINE ───',   channels: ['warnings-log','boot-log'] },
      { name: '🧠 ─── ADMIN ───',        channels: ['commissioner-ai','admin-hq','commish-hub','scoresheets'], adminOnly: true },
      { name: '🎮 ─── GAME CHANNELS ───', channels: [] },
    ],
  },
  nba2k_fantasy: {
    game: 'nba2k', id: 'nba2k_fantasy',
    label: 'NBA 2K Fantasy Draft',
    description: 'Fantasy draft where every team builds from scratch. Snake or auction.',
    emoji: '🎯', color: 0x552583, fullWeeks: 82, teamCount: 30,
    categories: [
      { name: '📢 ─── FANTASY 2K ───',   channels: ['announcements','rules','open-teams'] },
      { name: '🎯 ─── DRAFT ───',         channels: ['draft-board','draft-chat'] },
      { name: '🏀 ─── GAMEPLAY ───',      channels: ['game-results','weekly-schedule','stat-leaders'] },
      { name: '🔁 ─── TRANSACTIONS ───',  channels: ['trade-block','transactions'] },
      { name: '🎥 ─── MEDIA ───',         channels: ['highlights'] },
      { name: '⚠️ ─── DISCIPLINE ───',    channels: ['warnings-log','boot-log'] },
      { name: '🧠 ─── ADMIN ───',         channels: ['commissioner-ai','admin-hq','commish-hub','scoresheets'], adminOnly: true },
      { name: '🎮 ─── GAME CHANNELS ───', channels: [] },
    ],
  },
  nba2k_alltime: {
    game: 'nba2k', id: 'nba2k_alltime',
    label: 'NBA 2K All-Time Legends',
    description: 'Greatest of all time squads — MJ, Shaq, Kobe, LeBron, Bird, Magic.',
    emoji: '🐐', color: 0xffd700, fullWeeks: 60, teamCount: 30,
    categories: [
      { name: '📢 ─── ALL-TIME LEGENDS ───', channels: ['announcements','rules', 'server-guide','legends-board','open-teams','general'] },
      { name: '🏀 ─── GAMEPLAY ───',          channels: ['game-results','weekly-schedule','stat-leaders','goat-debate'] },
      { name: '🎥 ─── MEDIA ───',             channels: ['highlights'] },
      { name: '⚠️ ─── DISCIPLINE ───',        channels: ['warnings-log','boot-log'] },
      { name: '🧠 ─── ADMIN ───',             channels: ['commissioner-ai','admin-hq','commish-hub','scoresheets'], adminOnly: true },
      { name: '🎮 ─── GAME CHANNELS ───',     channels: [] },
    ],
  },

  // ── NBA 2K Pro-Am (Custom Leagues) ──────────────────────────
  // Pro-Am = custom league under 2K. Bot creates and tracks everything.
  // Not a standard in-game franchise — teams are user-created.
  nba2k_proam_8: { ...makeCustomSmallLeague({ game: 'nba2k', id: 'nba2k_proam_8', label: 'NBA 2K Pro-Am 8-Team Custom League', description: '8 fully custom teams. 20-game schedule. Bot tracks standings and seedings.', emoji: '🎮', color: 0x5865f2, teamCount: 8, scheduleGames: 20, formatLabel: '5v5 Pro-Am' }), isProAm: true },
  nba2k_proam_10: { ...makeCustomSmallLeague({ game: 'nba2k', id: 'nba2k_proam_10', label: 'NBA 2K Pro-Am 10-Team Custom League', description: '10 fully custom teams. 20-game schedule. Top 6 make the playoffs, no byes.', emoji: '🏆', color: 0xffd700, teamCount: 10, scheduleGames: 20, formatLabel: '5v5 Pro-Am' }), isProAm: true },
  madden_2v2_custom_10: makeCustomSmallLeague({ game: 'madden', id: 'madden_2v2_custom_10', label: 'Madden 2v2 Custom League (10 Teams)', description: '10 custom 2v2 squads. 10-game schedule. Top 6 make the playoffs with no byes.', emoji: '🏈', color: 0x0b7285, teamCount: 10, scheduleGames: 10, formatLabel: '2v2 Madden' }),
  madden_3v3_custom_10: makeCustomSmallLeague({ game: 'madden', id: 'madden_3v3_custom_10', label: 'Madden 3v3 Custom League (10 Teams)', description: '10 custom 3v3 squads. 10-game schedule. Top 6 make the playoffs with no byes.', emoji: '🛡️', color: 0x1d4ed8, teamCount: 10, scheduleGames: 10, formatLabel: '3v3 Madden' }),
  ncaa_2v2_custom_10: makeCustomSmallLeague({ game: 'ncaa', id: 'ncaa_2v2_custom_10', label: 'NCAA 2v2 Custom League (10 Teams)', description: '10 custom 2v2 programs. 10-game schedule. Top 6 make the playoffs with no byes.', emoji: '🎓', color: 0xff6b00, teamCount: 10, scheduleGames: 10, formatLabel: '2v2 NCAA' }),
  ncaa_3v3_custom_10: makeCustomSmallLeague({ game: 'ncaa', id: 'ncaa_3v3_custom_10', label: 'NCAA 3v3 Custom League (10 Teams)', description: '10 custom 3v3 programs. 10-game schedule. Top 6 make the playoffs with no byes.', emoji: '🏟️', color: 0xb45309, teamCount: 10, scheduleGames: 10, formatLabel: '3v3 NCAA' }),
  ncaa_dynasty: {
    game: 'ncaa', id: 'ncaa_dynasty',
    label: 'NCAA CFB Dynasty',
    description: 'College football dynasty. Recruiting, transfers, bowl games, CFP.',
    emoji: '🏟', color: 0xff6b00, fullWeeks: 12, teamCount: 134,
    categories: [
      { name: '📢 ─── CFB DYNASTY ───',  channels: ['announcements','rules','open-teams','general','college-chat'] },
      { name: '🏈 ─── GAMEPLAY ───',      channels: ['game-results','weekly-schedule','rankings','bowl-games','cfp-bracket'] },
      { name: '🎓 ─── ROSTER ───',        channels: ['recruiting','trade-block','transactions'] },
      { name: '🎥 ─── MEDIA ───',         channels: ['highlights','livestreams'] },
      { name: '⚠️ ─── DISCIPLINE ───',    channels: ['warnings-log','boot-log'] },
      { name: '🧠 ─── ADMIN ───',         channels: ['commissioner-ai','admin-hq','commish-hub','scoresheets'], adminOnly: true },
      { name: '🎮 ─── WEEK GAMES ───',    channels: [] },
    ],
  },
  ncaa_fantasy: {
    game: 'ncaa', id: 'ncaa_fantasy',
    label: 'NCAA CFB Fantasy Draft',
    description: 'Pick any college program. Snake draft, build your empire from scratch.',
    emoji: '🎓', color: 0x00843d, fullWeeks: 12, teamCount: 64,
    categories: [
      { name: '📢 ─── CFB FANTASY ───',  channels: ['announcements','rules','open-teams'] },
      { name: '🎓 ─── DRAFT ───',         channels: ['draft-board','draft-chat'] },
      { name: '🏈 ─── GAMEPLAY ───',      channels: ['game-results','weekly-schedule','rankings'] },
      { name: '🎥 ─── MEDIA ───',         channels: ['highlights'] },
      { name: '⚠️ ─── DISCIPLINE ───',    channels: ['warnings-log','boot-log'] },
      { name: '🧠 ─── ADMIN ───',         channels: ['commissioner-ai','admin-hq','commish-hub','scoresheets'], adminOnly: true },
      { name: '🎮 ─── WEEK GAMES ───',    channels: [] },
    ],
  },

  // (Pro-Am leagues are now under NBA 2K section as nba2k_proam_8 and nba2k_proam_10)
};

// ── Channel name → topic map (covers all league types) ────────
const CHANNEL_TOPICS = {
  'announcements':    'Official league announcements, scores, and news.',
  'server-guide':     'Bot & member guide — what you can do, how streams work, how to get boosts.',
  'rules':            'League rulebook. Read before playing.',
  'open-teams':       'Available slots. Use /select-team to claim.',
  'general':          'General league chat.',
  'nfl-chat':         'Real NFL talk.',
  'nba-chat':         'Real NBA talk.',
  'college-chat':     'Real college football talk.',
  'game-results':     'Post your scoreboard screenshots here — bot reads them automatically.',
  'weekly-schedule':  'This week matchups. Auto-reposts every 48hrs.',
  'stat-leaders':     'Weekly stat leaders by category.',
  'player-of-week':   'POTW awards. Each earns +2 attribute boost.',
  'rewards':          'Stream milestones, POTW history, yearly awards.',
  'dev-upgrades':     'All dev upgrades and attribute boosts logged here.',
  'superbowl':        'Super Bowl champions, forever.',
  'trade-block':      'Post players you are shopping.',
  'pending-trades':   'Trades awaiting commissioner review.',
  'accepted-trades':  'Approved trades.',
  'declined-trades':  'Rejected trades.',
  'transactions':     'All roster moves — signings, releases, cuts.',
  'livestreams':      '8 streams = Superstar dev. 16 = Dev Upgrade/Age Reset. Post link before halftime.',
  'highlights':       'Share your best plays and clips.',
  'force-wins':       'Force win decisions from the commissioner.',
  'fair-sims':        'Results for games that went to fair sim.',
  'warnings-log':     'All player warnings logged automatically. 3 = action.',
  'boot-log':         'Players removed from the league.',
  'commissioner-ai':  '[COMMISSIONER ONLY] AI assistant for league management.',
  'admin-hq':         '[COMMISSIONER ONLY] Private commissioner coordination channel.',
  'commish-hub':      '[COMMISSIONER ONLY] Drop screenshots here — bot releases at 6:59pm PST.',
  'scoresheets':      '[COMMISSIONER ONLY] Auto-generated weekly scoresheets.',
  'draft-board':      'Draft order, picks, and results.',
  'draft-chat':       'Live draft talk.',
  'free-agency':      'FA moves and signings.',
  'awards':           'MVP, DPOY, ROY, champion awards.',
  'legends-board':    'All-time team rosters and ratings.',
  'goat-debate':      'GOAT debates live here.',
  'rankings':         'Weekly rankings and standings.',
  'bowl-games':       'Bowl game matchups and results.',
  'cfp-bracket':      'College Football Playoff bracket.',
  'recruiting':       'Recruiting news and commits.',
  'playbook-check':   'Submit playbooks for review.',
  'replay-review':    'Submit replays for violation review.',
  'afc-results':      'AFC game scoreboard screenshots.',
  'afc-schedule':     'AFC weekly schedule.',
  'afc-standings':    'AFC conference standings.',
  'nfc-results':      'NFC game scoreboard screenshots.',
  'nfc-schedule':     'NFC weekly schedule.',
  'nfc-standings':    'NFC conference standings.',
  'championship':     'Conference championships and Super Bowl.',
  'standings':        'Live standings — updated after every game result.',
  'schedule':         'Full season schedule — generated before the season starts.',
  'scoreboard':       'Current week scoreboard. Updates automatically.',
  'league-news':      'AI-generated league news articles after every game.',
  'media-highlights': 'Best plays and clips from league games.',
  'trade-block':      'Players and assets on the block.',
};

// ── Round-robin schedule generator ───────────────────────────
// Produces a balanced schedule where every team plays every other team.
// partial = 75% of full weeks. half = 50%.
function generateSchedule(teams, seasonType, fullWeeks, opts = {}) {
  const totalWeeks = Number(opts.exactWeeks) > 0 ? Number(opts.exactWeeks) : getSeasonWeeks(fullWeeks, seasonType, opts.game);
  const n          = teams.length;
  if (n < 2) return [];

  const schedule  = [];
  const teamList  = [...teams];
  // Add a bye team if odd number
  if (n % 2 !== 0) teamList.push('BYE');
  const m        = teamList.length;
  const fixed    = teamList[0];
  const rotating = teamList.slice(1);
  const rounds   = m - 1; // one full round-robin

  let week = 1;
  while (week <= totalWeeks) {
    const roundIdx = (week - 1) % rounds;
    const rot = [...rotating.slice(roundIdx), ...rotating.slice(0, roundIdx)];
    const pairs = [[fixed, rot[0]]];
    for (let i = 1; i < m / 2; i++) pairs.push([rot[i], rot[m - 2 - i]]);
    for (const [h, a] of pairs) {
      if (h !== 'BYE' && a !== 'BYE') schedule.push({ week, home: h, away: a });
    }
    week++;
  }
  return schedule;
}

// ── Post full season schedule to #schedule channel ────────────
async function postFullSchedule(guild, leagueId, schedule, leagueLabel, color) {
  const schedCh = guild.channels.cache.find(c =>
    c.isTextBased?.() && (c.name.includes('schedule') || c.name.includes('weekly-schedule'))
    && !c.name.includes('commish')
  );
  if (!schedCh || !schedule.length) return;

  // Group by week
  const byWeek = {};
  for (const g of schedule) {
    if (!byWeek[g.week]) byWeek[g.week] = [];
    byWeek[g.week].push(g);
  }

  // Post header
  await schedCh.send({
    embeds: [new EmbedBuilder()
      .setColor(color || 0x5865f2)
      .setTitle(`📅 ${leagueLabel} — Full Season Schedule`)
      .setDescription(
        `**${schedule.length} total games** across **${Object.keys(byWeek).length} weeks**\n\n` +
        `Each matchup runs on the **48-hour advance clock**.\n` +
        `Both players must confirm scheduling within 24 hours or a force loss may be issued.\n\n` +
        `Scores auto-update below after game results are posted in #game-results.`
      )
      .setTimestamp()],
  }).catch(() => null);

  // Post each week as a separate embed (batched to avoid rate limits)
  const weekNums = Object.keys(byWeek).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < weekNums.length; i += 4) {
    const batch = weekNums.slice(i, i + 4);
    const fields = batch.map(wk => ({
      name: `Week ${wk}`,
      value: byWeek[wk].map(g => `🏠 **${g.home}** vs ✈️ **${g.away}**`).join('\n'),
      inline: true,
    }));
    await schedCh.send({
      embeds: [new EmbedBuilder().setColor(color || 0x5865f2).addFields(fields).setTimestamp()],
    }).catch(() => null);
    if (i + 4 < weekNums.length) await new Promise(r => setTimeout(r, 500));
  }
}

// ── Build and post live standings board ───────────────────────
async function buildStandingsEmbed(leagueId, teams, label, color, state) {
  const records = loadJson(`standings_${leagueId}.json`, {});

  // Initialize missing teams
  for (const t of teams) {
    if (!records[t]) records[t] = { w: 0, l: 0, pf: 0, pa: 0 };
  }

  const sorted = teams
    .map(t => ({ team: t, ...records[t] }))
    .sort((a, b) => {
      if (b.w !== a.w) return b.w - a.w;          // wins
      const aDiff = a.pf - a.pa, bDiff = b.pf - b.pa;
      if (bDiff !== aDiff) return bDiff - aDiff;   // point diff
      return b.pf - a.pf;                           // points for
    });

  const rows = sorted.map((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const pct   = (r.w + r.l) > 0 ? (r.w / (r.w + r.l)).toFixed(3) : '.000';
    return `${medal} **${r.team}** — ${r.w}W ${r.l}L (${pct}) | PF: ${r.pf} | PA: ${r.pa}`;
  });

  const config = (state?.leagueConfig?.proAm && state.leagueConfig.proAm[leagueId]) || {};
  const playoffText = config.playoffTeams ? ` Top ${config.playoffTeams} make playoffs. No bye seeds.` : 'Updates automatically after every game result.';
  return new EmbedBuilder()
    .setColor(color || 0x5865f2)
    .setTitle(`🏆 ${label} — Standings`)
    .setDescription(rows.join('\n') || 'No games played yet.')
    .setFooter({ text: playoffText })
    .setTimestamp();
}

async function refreshStandings(guild, leagueId, teams, label, color, state) {
  const standingsCh = guild.channels.cache.find(c =>
    c.isTextBased?.() && c.name.includes('standings') && !c.name.includes('afc') && !c.name.includes('nfc')
  );
  if (!standingsCh) return;

  const embed = await buildStandingsEmbed(leagueId, teams, label, color, state);

  // Find and edit existing standings message or post new one
  const storedId = state.leagueConfig[`standings_msg_${leagueId}`];
  if (storedId) {
    try {
      const msg = await standingsCh.messages.fetch(storedId);
      await msg.edit({ embeds: [embed] });
      return;
    } catch {}
  }
  const sent = await standingsCh.send({ embeds: [embed] }).catch(() => null);
  if (sent) {
    state.leagueConfig[`standings_msg_${leagueId}`] = sent.id;
    saveJsonDebounced('leagueConfig.json', state.leagueConfig);
  }
}

// Update standings after a game result
function recordGameResult(leagueId, homeTeam, awayTeam, homeScore, awayScore) {
  const records = loadJson(`standings_${leagueId}.json`, {});
  if (!records[homeTeam]) records[homeTeam] = { w: 0, l: 0, pf: 0, pa: 0 };
  if (!records[awayTeam]) records[awayTeam] = { w: 0, l: 0, pf: 0, pa: 0 };

  records[homeTeam].pf += homeScore;
  records[homeTeam].pa += awayScore;
  records[awayTeam].pf += awayScore;
  records[awayTeam].pa += homeScore;

  if (homeScore > awayScore) { records[homeTeam].w++; records[awayTeam].l++; }
  else if (awayScore > homeScore) { records[awayTeam].w++; records[homeTeam].l++; }
  else { /* tie — no W/L change */ }

  saveJsonDebounced(`standings_${leagueId}.json`, records);
  return records;
}

// V202 (BUG-006): exact inverse of recordGameResult so a superseded/retracted result can be un-applied
// without double counting. Called only by league/gameResultService (the single result owner).
function reverseGameResult(leagueId, homeTeam, awayTeam, homeScore, awayScore) {
  const records = loadJson(`standings_${leagueId}.json`, {});
  if (!records[homeTeam] || !records[awayTeam]) return records;
  records[homeTeam].pf = Math.max(0, records[homeTeam].pf - homeScore);
  records[homeTeam].pa = Math.max(0, records[homeTeam].pa - awayScore);
  records[awayTeam].pf = Math.max(0, records[awayTeam].pf - awayScore);
  records[awayTeam].pa = Math.max(0, records[awayTeam].pa - homeScore);
  if (homeScore > awayScore) { records[homeTeam].w = Math.max(0, records[homeTeam].w - 1); records[awayTeam].l = Math.max(0, records[awayTeam].l - 1); }
  else if (awayScore > homeScore) { records[awayTeam].w = Math.max(0, records[awayTeam].w - 1); records[homeTeam].l = Math.max(0, records[homeTeam].l - 1); }
  saveJsonDebounced(`standings_${leagueId}.json`, records);
  return records;
}

// ── AI article generator (wired to game results) ──────────────
async function generateGameArticle(guild, game, aiCall, MODELS) {
  const newsCh = guild.channels.cache.find(c =>
    c.isTextBased?.() && (c.name.includes('league-news') || c.name.includes('announcements'))
    && !c.name.includes('nfl-chat') && !c.name.includes('nba-chat')
  );
  if (!newsCh || !aiCall) return;

  try {
    const res = await aiCall({
      model: MODELS.FAST,
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `You are a sports journalist for ${resolveServerName(guild, 'this server')}. Write a short game recap article (3-4 sentences) in the style of ESPN or Bleacher Report.
Game: ${game.winner} def. ${game.loser} ${game.winnerScore}-${game.loserScore}
${game.stats ? `Key stats: ${game.stats}` : ''}
${game.week ? `Week ${game.week}` : ''}

Write it like a real sports article — hype the winner a little, acknowledge the loser. Be punchy. Use sports journalism language. No filler. End with one forward-looking sentence about what this means for the standings.`,
      }],
    });

    const article = res.content[0].text.trim();
    await newsCh.send({
      embeds: [new EmbedBuilder()
        .setColor(0x1a73e8)
        .setTitle(`📰 ${game.winner} ${game.winnerScore} — ${game.loserScore} ${game.loser}`)
        .setDescription(article)
        .setFooter({ text: `Week ${game.week || '?'} • ${resolveServerName(guild, 'this server')}` })
        .setTimestamp()],
    }).catch(() => null);
  } catch (e) {
    log.error('Article generation failed:', e.message);
  }
}

// ── Channel builder ───────────────────────────────────────────
async function buildLeagueStructure(guild, leagueTypeId, commRoleId, leagueName) {
  const def = LEAGUE_TYPES[leagueTypeId];
  if (!def) throw new Error(`Unknown league type: ${leagueTypeId}`);

  const rulesText = SHARED_RULES[def.game] || SHARED_RULES.madden;

  let createdCount = 0;
  const builtChannels = {};
  const builtCategoryIds = [];
  const builtChannelIds = [];

  for (const cat of def.categories) {
    const catName = sharedCategoryNameFor(def.game, cat);

    // V198 FIX: Use findOrCreateCategory instead of raw guild.channels.create
    const { findOrCreateCategory: _findOrCreateCat } = require('./baseInitService');
    const overwrites = buildStaffOverwrites(guild, commRoleId, !!cat.adminOnly);
    const category = await _findOrCreateCat(guild, catName, overwrites);
    builtCategoryIds.push(category.id);

    for (const chKey of cat.channels) {
      const topic = CHANNEL_TOPICS[chKey] || '';
      const isAdmin = !!cat.adminOnly;
      const channelName = leagueChannelName(leagueName, chKey, def.label);
      const overwrites = channelPermsForKey(guild, commRoleId, chKey, isAdmin);

      const existing = guild.channels.cache.find(c =>
        c.isTextBased?.() && c.parentId === category.id && c.name === channelName
      );
      if (existing) {
        builtChannels[chKey] = existing;
        builtChannelIds.push(existing.id);
        continue;
      }

      const created = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: topic ? `[${leagueName || def.label}] ${topic}` : `[${leagueName || def.label}]`,
        permissionOverwrites: overwrites,
      }).catch(e => { log.error(`Failed to create ${channelName}:`, e.message); return null; });

      if (created) {
        builtChannels[chKey] = created;
        builtChannelIds.push(created.id);
        createdCount++;
      }
    }
  }

  const activeLeague = activeLeagueService.upsertLeague({
    id: `${leaguePrefixCode(leagueName, def.label)}-${Date.now()}`,
    leagueTypeId,
    leagueName: leagueName,
    game: def.game,
    builtCategoryIds,
    builtChannelIds,
    isCustom: !!def.isCustom,
    createdAt: Date.now(),
  });

  const seeded = seedLeagueTeams(stateRef, def, activeLeague);
  try { require('./openTeamsService').refreshOpenTeamsBoard(guild).catch(() => null); } catch {}

  log.info(`Built ${def.label}${leagueName ? ` (${leagueName})` : ''} — ${createdCount} channels in shared categories. Seeded ${seeded.seeded || 0} team slots.`);
  return { def, createdCount, builtChannels, builtCategoryIds, builtChannelIds, activeLeague, seeded };
}

// ── Smart reset league structure (only essential categories) ─────────
// Only creates: League Info, Gameplay, Rosters & Trades, Media, Weekly Games, Admin HQ
async function buildSimplifiedLeagueStructure(guild, leagueTypeId, commRoleId, leagueName) {
  const def = LEAGUE_TYPES[leagueTypeId];
  if (!def) throw new Error(`Unknown league type: ${leagueTypeId}`);
  const rulesText = SHARED_RULES[def.game] || SHARED_RULES.madden;

  const simplifiedCategories = [
    { name: sharedCategoryNameFor(def.game, { name: 'info', channels: ['announcements','rules','general'] }), channels: ['announcements', 'rules', 'general'] },
    { name: sharedCategoryNameFor(def.game, { name: 'gameplay', channels: ['game-results','weekly-schedule','stat-leaders','player-of-week'] }), channels: ['game-results', 'weekly-schedule', 'stat-leaders', 'player-of-week'] },
    { name: sharedCategoryNameFor(def.game, { name: 'rosters', channels: ['trade-block','transactions'] }), channels: ['trade-block', 'transactions'] },
    { name: sharedCategoryNameFor(def.game, { name: 'media', channels: ['highlights','livestreams'] }), channels: ['highlights', 'livestreams'] },
    { name: '🧠 STAFF HQ', channels: ['commissioner-ai', 'admin-hq', 'commish-hub', 'scoresheets'], adminOnly: true },
  ];

  let createdCount = 0;
  const builtChannels = {};
  const builtCategoryIds = [];
  const builtChannelIds = [];

  for (const cat of simplifiedCategories) {
    // V198 FIX: Use findOrCreateCategory instead of raw guild.channels.create
    const { findOrCreateCategory: _findOrCreateCat2 } = require('./baseInitService');
    const overwrites = buildStaffOverwrites(guild, commRoleId, !!cat.adminOnly);
    const category = await _findOrCreateCat2(guild, cat.name, overwrites);
    builtCategoryIds.push(category.id);

    for (const chKey of cat.channels) {
      const topic = CHANNEL_TOPICS[chKey] || '';
      const isAdmin = !!cat.adminOnly;
      const channelName = leagueChannelName(leagueName, chKey, def.label);
      const overwrites = channelPermsForKey(guild, commRoleId, chKey, isAdmin);

      const existing = guild.channels.cache.find(c => c.isTextBased?.() && c.parentId === category.id && c.name === channelName);
      if (existing) {
        builtChannels[chKey] = existing;
        builtChannelIds.push(existing.id);
        continue;
      }

      const created = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: topic ? `[${leagueName}] ${topic}` : `[${leagueName}]`,
        permissionOverwrites: overwrites,
      }).catch(e => { log.error(`Failed to create ${channelName}:`, e.message); return null; });

      if (created) {
        builtChannels[chKey] = created;
        builtChannelIds.push(created.id);
        createdCount++;
      }
    }
  }

  const activeLeague = activeLeagueService.upsertLeague({
    id: `${leaguePrefixCode(leagueName, def.label)}-${Date.now()}`,
    leagueTypeId,
    leagueName: leagueName,
    game: def.game,
    builtCategoryIds,
    builtChannelIds,
    isCustom: !!def.isCustom,
    createdAt: Date.now(),
  });

  const seeded = seedLeagueTeams(stateRef, def, activeLeague);
  try { require('./openTeamsService').refreshOpenTeamsBoard(guild).catch(() => null); } catch {}

  log.info(`Reset to ${def.label} (${leagueName}) — ${createdCount} channels created/reset in shared categories. Seeded ${seeded.seeded || 0} team slots.`);
  return { def, createdCount, builtChannels, builtCategoryIds, builtChannelIds, activeLeague, seeded };
}

// ── Delete every channel and category that was built for a league ──────────────
// Pass the arrays saved from buildLeagueStructure: categoryIds + channelIds.
// Falls back to fuzzy name matching from LEAGUE_TYPES if no IDs stored (legacy).
async function deleteLeagueStructure(guild, { categoryIds = [], channelIds = [], typeId = null } = {}) {
  let deleted = 0;

  // Delete by stored IDs (accurate, fast)
  const toDelete = new Set([...channelIds, ...categoryIds]);

  // If we have stored IDs, delete those
  if (toDelete.size > 0) {
    for (const id of toDelete) {
      const ch = guild.channels.cache.get(id);
      if (!ch) continue;
      await ch.delete('League structure erased by commissioner').catch(e =>
        log.warn(`Could not delete channel/category ${id}:`, e.message)
      );
      deleted++;
      await new Promise(r => setTimeout(r, 300)); // rate limit buffer
    }
    log.info(`Deleted ${deleted} channels/categories by stored IDs.`);
    return deleted;
  }

  // Fallback: fuzzy-match by category names from the league type definition
  if (typeId && LEAGUE_TYPES[typeId]) {
    const def = LEAGUE_TYPES[typeId];
    const catNames = new Set(def.categories.map(c => c.name.toLowerCase()));
    const channelKeys = new Set(def.categories.flatMap(c => c.channels));

    // Delete text channels first (can't delete category with children)
    for (const [, ch] of guild.channels.cache) {
      if (!ch.isTextBased?.()) continue;
      // Match by parent category name or by channel key name
      const parentCat = ch.parent;
      const parentMatch = parentCat && catNames.has(parentCat.name.toLowerCase());
      const keyMatch = [...channelKeys].some(k => ch.name.includes(k));
      if (parentMatch || keyMatch) {
        await ch.delete('League structure erased').catch(() => null);
        deleted++;
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // Now delete categories
    for (const [, ch] of guild.channels.cache) {
      if (ch.type !== ChannelType.GuildCategory) continue;
      if (catNames.has(ch.name.toLowerCase())) {
        await ch.delete('League structure erased').catch(() => null);
        deleted++;
        await new Promise(r => setTimeout(r, 300));
      }
    }

    log.info(`Deleted ${deleted} channels/categories by name matching.`);
  }

  return deleted;
}

// ── Pro-Am team entry wizard ──────────────────────────────────
// Stores in-progress Pro-Am setup in state.pendingSetup[userId].proam
function startProAmSetup(interaction, state, typeId) {
  if (!state.pendingSetup) state.pendingSetup = {};
  state.pendingSetup[interaction.user.id] = {
    typeId,
    step: 'proam_teams',
    teams: [],
    teamsNeeded: typeId === 'proam_8' ? 8 : 10,
    seasonType: 'full',
  };
}

async function showProAmTeamEntry(interaction, state) {
  const pending = state.pendingSetup?.[interaction.user.id];
  if (!pending) return;

  const def      = LEAGUE_TYPES[pending.typeId];
  const needed   = pending.teamsNeeded;
  const soFar    = pending.teams.length;
  const isLast   = soFar === needed - 1;

  // Use a modal for team entry (city + name fields)
  const modal = new ModalBuilder()
    .setCustomId('setup_proam_team_modal')
    .setTitle(`Team ${soFar + 1} of ${needed}${isLast ? ' (Last one!)' : ''}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('team_city')
        .setLabel('City / State (e.g. Sacramento, Houston)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('team_name')
        .setLabel('Team Name (e.g. Kings, Rockets)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('team_owner')
        .setLabel('Owner Discord username (e.g. wthames) — optional')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(50)
    ),
  );

  await interaction.showModal(modal);
}

async function handleProAmTeamModal(interaction, state, aiCall, MODELS) {
  const pending = state.pendingSetup?.[interaction.user.id];
  if (!pending || pending.step !== 'proam_teams') return;

  const city  = interaction.fields.getTextInputValue('team_city').trim();
  const name  = interaction.fields.getTextInputValue('team_name').trim();
  const owner = interaction.fields.getTextInputValue('team_owner').trim() || null;

  pending.teams.push({ city, name, displayName: `${city} ${name}`, owner });

  const soFar  = pending.teams.length;
  const needed = pending.teamsNeeded;

  await interaction.reply({
    content: `✅ **Team ${soFar}:** ${city} ${name}${owner ? ` (owner: ${owner})` : ''}\n` +
             (soFar < needed ? `${needed - soFar} more team${needed - soFar > 1 ? 's' : ''} to go.` : `All ${needed} teams entered! Building your league...`),
    flags: 64,
  });

  if (soFar < needed) {
    // Prompt next team via button
    const btn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('setup_proam_next_team')
        .setLabel(`Enter Team ${soFar + 1}`)
        .setStyle(ButtonStyle.Primary),
    );
    await interaction.followUp({ content: `Click below to enter team ${soFar + 1} of ${needed}.`, components: [btn], flags: 64 });
  } else {
    // All teams entered — build the league
    await interaction.followUp({ content: '⚙️ Building your Pro-Am league...', flags: 64 });
    await finalizeProAmSetup(interaction, state, aiCall, MODELS);
  }
}

async function finalizeProAmSetup(interaction, state, aiCall, MODELS) {
  const pending = state.pendingSetup?.[interaction.user.id];
  if (!pending) return;

  const def        = LEAGUE_TYPES[pending.typeId];
  const teams      = pending.teams.map(t => t.displayName);
  const leagueName = 'PRO-AM';

  delete state.pendingSetup[interaction.user.id];

  try {
    const guild = interaction.guild;
    const { createdCount, builtChannels } = await buildLeagueStructure(
      guild, pending.typeId, COMM_ROLE, leagueName
    );

    // Generate schedule
    const schedule = generateSchedule(teams, pending.seasonType, def.fullWeeks, { game: def.game, exactWeeks: def.scheduleGames || null });
    const leagueId = `proam_${Date.now()}`;

    // Save to state
    state.leagueConfig.proAm = state.leagueConfig.proAm || {};
    state.leagueConfig.proAm[leagueId] = {
      id: leagueId, typeId: pending.typeId, teams: pending.teams,
      schedule, seasonType: pending.seasonType, playoffTeams: def.playoffTeams || null, playoffsNoByes: !!def.playoffsNoByes, formatLabel: def.formatLabel || null, createdAt: Date.now(),
    };
    saveJsonDebounced('leagueConfig.json', state.leagueConfig);

    // Post full season schedule
    await postFullSchedule(guild, leagueId, schedule, `${leagueName} — ${def.label}`, def.color);

    // Post initial standings
    await refreshStandings(guild, leagueId, teams, `${leagueName} — ${def.label}`, def.color, state);

    const totalWeeks = getSeasonWeeks(def.fullWeeks, pending.seasonType, def.game);

    await interaction.followUp({
      embeds: [new EmbedBuilder()
        .setColor(def.color)
        .setTitle(`✅ ${def.emoji} Pro-Am League Built!`)
        .setDescription(
          `**${createdCount} channels created.**\n\n` +
          `**Teams (${teams.length}):**\n${pending.teams.map(t => `> 🏅 **${t.displayName}**${t.owner ? ` — ${t.owner}` : ''}`).join('\n')}\n\n` +
          `**Season:** ${totalWeeks} weeks | ${schedule.length} total games\n` +
          `${def.playoffTeams ? `**Playoffs:** Top ${def.playoffTeams} teams, no bye seeds\n\n` : '\n'}` +
          `📅 Full schedule posted in #schedule\n📊 Live standings in #standings — updates after every game result\n📰 AI articles generated after every game in #league-news\n\n` +
          `**To upload a team logo/emoji:** Upload the image in the server emoji settings, then use \`/set-team-logo\` to link it.\n` +
          `**To update scores:** Post screenshots in #game-results — bot reads them automatically.`
        )
        .setFooter({ text: `${def.label} • ${totalWeeks}-week season` })
        .setTimestamp()],
      flags: 64,
    });
  } catch (err) {
    log.error('Pro-Am build failed:', err.message);
    await interaction.followUp({ content: `❌ Build failed: ${err.message}`, flags: 64 });
  }
}

async function getLeagueRulesChannel(guild, league) {
  const ids = new Set(league?.builtChannelIds || []);
  let ch = [...ids].map(id => guild.channels.cache.get(id)).find(c => c?.isTextBased?.() && /(^|\.)rules$/i.test(c.name || '')) || null;
  if (ch) return ch;
  const lname = String(league?.leagueName || '').toLowerCase();
  return guild.channels.cache.find(c => c?.isTextBased?.() && /(^|\.)rules$/i.test(c.name || '') && String(c.topic || '').toLowerCase().includes(lname)) || null;
}

async function publishLeagueRulesForPreset(guild, league, presetKey) {
  const preset = LEAGUE_RULE_PRESETS[presetKey] || LEAGUE_RULE_PRESETS.competitive_default;
  const rulesCh = await getLeagueRulesChannel(guild, league);
  if (!rulesCh) throw new Error('League rules channel not found.');
  const recent = await rulesCh.messages.fetch({ limit: 25 }).catch(() => null);
  for (const m of (recent ? [...recent.values()] : [])) {
    if (m.author?.id === guild.members.me?.id) await m.delete().catch(() => null);
  }
  await rulesCh.send({ embeds: [new EmbedBuilder().setColor(0x00b4d8).setTitle(`📖 ${league.leagueName} — ${preset.label} Rules`).setDescription(preset.text).setTimestamp()], allowedMentions:{parse:[]} }).catch(() => null);
  stateRef.leagueConfig.rulesText = preset.text;
  stateRef.leagueConfig.rulesUpdatedAt = Date.now();
  saveJsonDebounced('leagueConfig.json', stateRef.leagueConfig);
  return preset;
}

// ── Setup wizard ──────────────────────────────────────────────
async function sendSetupWizard(interaction, state) {
  state = state || stateRef;
  const gameRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('setup_game_select')
      .setPlaceholder('🎮 Choose your game first...')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('🏈 Madden NFL').setValue('madden')
          .setDescription('Franchise, Fantasy, All-Time, Sim, Dual Division (Custom)').setEmoji('🏈'),
        new StringSelectMenuOptionBuilder().setLabel('🏀 NBA 2K').setValue('nba2k')
          .setDescription('MyNBA, Fantasy, All-Time, Pro-Am Custom Leagues').setEmoji('🏀'),
        new StringSelectMenuOptionBuilder().setLabel('🏟 NCAA College Football').setValue('ncaa')
          .setDescription('Dynasty, Fantasy Draft').setEmoji('🏟'),
      )
  );

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🏟 ${state?.leagueConfig?.leagueName || 'League'} — League Setup Wizard`)
      .setDescription(
        'Welcome, Commissioner. Let\'s build your league.\n\n' +
        '**Step 1:** Choose your game below.\n\n' +
        '> 🏈 **Madden** — Franchise, Fantasy, All-Time Greats, Sim, Dual Division *(custom)*\n' +
        '> 🏀 **NBA 2K** — MyNBA, Fantasy Draft, All-Time Legends, Pro-Am *(custom)*\n' +
        '> 🏟 **NCAA CFB** — Dynasty, Fantasy Draft\n\n' +
        '**Custom leagues** (marked above) = bot creates and tracks everything:\n' +
        'schedules, standings, seedings, playoffs. These are leagues that can\'t be set up in-game.\n\n' +
        'All leagues run on the **48-hour advance clock**, shared discipline rules, ' +
        'live standings (W/L/PF/PA), and AI-generated game articles.'
      )
      .setFooter({ text: 'Select a game below to continue.' })
      .setTimestamp()],
    components: [gameRow],
  });
}

// ── Interaction router ────────────────────────────────────────
async function handleSetupInteraction(interaction, state) {
  const cid = interaction.customId;

  if (interaction.isStringSelectMenu?.() && cid.startsWith('setup_ruleset_select::')) {
    const leagueId = cid.split('::')[1];
    const league = activeLeagueService.getLeague(leagueId);
    if (!league) return interaction.update({ content: '❌ League not found for rule setup.', components: [], embeds: [] });
    const presetKey = interaction.values[0];
    const preset = await publishLeagueRulesForPreset(interaction.guild, league, presetKey);
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ League Rules Equipped').setDescription(`**${league.leagueName}** now uses the **${preset.label}** ruleset.`).setTimestamp()],
      components: [],
    });
  }

  // ── Step 1: Game selected ──────────────────────────────────
  if (cid === 'setup_game_select') {
    const game    = interaction.values[0];
    const options = Object.values(LEAGUE_TYPES).filter(t => t.game === game);

    if (!options.length) return interaction.update({ content: '❌ No leagues for that game.', components: [] });

    const typeRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('setup_type_select')
        .setPlaceholder('🏟 Choose league type...')
        .addOptions(options.slice(0, 10).map(t =>
          new StringSelectMenuOptionBuilder()
            .setLabel(t.label.slice(0, 100))
            .setValue(t.id)
            .setDescription(t.description.slice(0, 100))
            .setEmoji(t.emoji)
        ))
    );

    const gameLabels = { madden: '🏈 Madden NFL', nba2k: '🏀 NBA 2K', ncaa: '🏟 NCAA CFB', proam: '🎮 Pro-Am Custom' };
    await interaction.update({
      embeds: [new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`${gameLabels[game]} — Choose League Type`)
        .setDescription(options.map(t => `**${t.emoji} ${t.label}**\n> ${t.description}`).join('\n\n'))
        .setFooter({ text: 'Step 2: Select league type below.' })
        .setTimestamp()],
      components: [typeRow],
    });
    return;
  }

  // ── Step 2: League type selected ──────────────────────────
  if (cid === 'setup_type_select') {
    const typeId = interaction.values[0];
    const def    = LEAGUE_TYPES[typeId];
    if (!def) return interaction.update({ content: '❌ Unknown league type.', components: [] });

    if (!state.pendingSetup) state.pendingSetup = {};
    state.pendingSetup[interaction.user.id] = { typeId, leagueName: state.leagueConfig?.leagueName || null };

    // Pro-Am goes to team entry wizard
    if (def.isProAm) {
      startProAmSetup(interaction, state, typeId);
      const btn = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('setup_proam_next_team').setLabel('Enter Team 1').setStyle(ButtonStyle.Primary)
      );
      await interaction.update({
        embeds: [new EmbedBuilder()
          .setColor(def.color)
          .setTitle(`${def.emoji} ${def.label} — Team Entry`)
          .setDescription(
            `You\'ll enter **${def.teamCount} teams** one at a time.\n` +
            `For each team provide: **City/State** and **Team Name**.\n\n` +
            `You can also link a Discord emoji as the team logo with \`/set-team-logo\` after setup.\n\n` +
            `Click below to start entering teams.`
          )
          .setFooter({ text: `${def.teamCount} teams needed.` })
          .setTimestamp()],
        components: [btn],
      });
      return;
    }

    // Standard league — show season length picker
    const fullWeeks    = def.fullWeeks;
    const partialWeeks = getSeasonWeeks(fullWeeks, 'partial', def?.game);
    const halfWeeks    = getSeasonWeeks(fullWeeks, 'half', def?.game);

    const seasonRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('setup_season_select')
        .setPlaceholder('📅 Choose season length...')
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(`Full Season — ${fullWeeks} weeks`)
            .setValue('full')
            .setDescription('Complete regular season schedule.')
            .setEmoji('📅'),
          new StringSelectMenuOptionBuilder()
            .setLabel(`Partial Season — ${partialWeeks} weeks (75%)`)
            .setValue('partial')
            .setDescription('75% of full season — everyone plays most opponents.')
            .setEmoji('📆'),
          new StringSelectMenuOptionBuilder()
            .setLabel(`Half Season — ${halfWeeks} weeks (50%)`)
            .setValue('half')
            .setDescription('Quick league — half the regular season.')
            .setEmoji('⚡'),
        )
    );

    await interaction.update({
      embeds: [new EmbedBuilder()
        .setColor(def.color)
        .setTitle(`${def.emoji} ${def.label}`)
        .setDescription(
          `${def.description}\n\n` +
          `**Teams:** Up to ${def.teamCount}\n\n` +
          `**Season length options:**\n` +
          `> 📅 **Full** — ${fullWeeks} weeks (100%)\n` +
          `> 📆 **Partial** — ${partialWeeks} weeks (75%)\n` +
          `> ⚡ **Half** — ${halfWeeks} weeks (50%)`
        )
        .setFooter({ text: 'Step 3: Select season length below.' })
        .setTimestamp()],
      components: [seasonRow],
    });
    return;
  }

  // ── Step 3: Season length selected — BUILD ─────────────────
  if (cid === 'setup_season_select') {
    const seasonType = interaction.values[0];
    const pending    = state.pendingSetup?.[interaction.user.id];
    if (!pending) return interaction.update({ content: '❌ Session expired. Run /setup-league again.', components: [] });

    const { typeId, leagueName: pendingLeagueName } = pending;
    const def        = LEAGUE_TYPES[typeId];
    delete state.pendingSetup[interaction.user.id];

    await interaction.update({
      embeds: [new EmbedBuilder()
        .setColor(def.color)
        .setTitle(`⚙️ Building ${def.label}...`)
        .setDescription('Creating channels and categories. One moment...')
        .setTimestamp()],
      components: [],
    });

    try {
      const guild = interaction.guild;
      const setupLeagueName = pendingLeagueName || state.leagueConfig?.leagueName;
      if (!setupLeagueName) throw new Error('League name is required. Run /setup-league again with league-name.');
      const { createdCount, builtCategoryIds, builtChannelIds, seeded, activeLeague } = await buildLeagueStructure(guild, typeId, COMM_ROLE, setupLeagueName);

      const weeks = getSeasonWeeks(def.fullWeeks, seasonType, def.game);

      state.leagueConfig.leagueTypeId    = typeId;
      state.leagueConfig.seasonType      = seasonType;
      state.leagueConfig.game            = def.game;
      state.leagueConfig.seasonWeeks     = weeks;
      state.leagueConfig.builtCategoryIds = builtCategoryIds;
      state.leagueConfig.builtChannelIds  = builtChannelIds;
      saveJsonDebounced('leagueConfig.json', state.leagueConfig);

            const activeLeagueId = activeLeague?.id || activeLeagueService.listActiveLeagues().slice(-1)[0]?.id;
      const rulesRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`setup_ruleset_select::${activeLeagueId}`)
          .setPlaceholder('📖 Choose league rules to equip...')
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel('Competitive Default').setValue('competitive_default').setDescription('Standard competitive ruleset').setEmoji('🏈'),
            new StringSelectMenuOptionBuilder().setLabel('Sim League').setValue('sim').setDescription('Tighter sim-style gameplay expectations').setEmoji('🎲'),
            new StringSelectMenuOptionBuilder().setLabel('Custom / Pro-Am').setValue('custom_proam').setDescription('Bot-managed custom league rules').setEmoji('🏆'),
          )
      );
      const featureRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`toggle_active_check::${activeLeagueId}`).setLabel('Enable 4-Day Active Check').setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(def.color)
          .setTitle(`✅ ${def.emoji} ${def.label} — Ready!`)
          .setDescription(
            `Your league is live, Commissioner.

` +
            `**League:** ${setupLeagueName}
` +
            `**${createdCount} channels** created inside shared categories.
` +
            `**Teams seeded:** ${seeded?.seeded || 0}
` +
            `**Season:** ${seasonType === 'full' ? 'Full' : seasonType === 'partial' ? '75% Partial' : 'Half'} — ${weeks} weeks

` +
            `**Next steps:**
` +
            `> 1. Pick a league rules preset below\n` +
            `> 2. Optional: enable the 4-day active check rule below\n` +
            `> 3. Members use \`/join-league\` to browse available leagues\n` +
            `> 4. Use \`/set-hub-week 1\` when you are ready to start\n` +
            `> 5. Drop screenshots in #commish-hub each week\n\n` +
            `Server rules stay in the base #rules channel. League rules and league features are equipped per league.`
          )
          .setFooter({ text: `${def.label} • ${weeks}-week season` })
          .setTimestamp()],
        components: [rulesRow, featureRow],
      });
    } catch (err) {
      log.error('Build failed:', err.message);
      await interaction.editReply({ content: `❌ Build failed: ${err.message}`, components: [] });
    }
  }

  // ── Pro-Am: next team button ───────────────────────────────
  if (cid === 'setup_proam_next_team') {
    await showProAmTeamEntry(interaction, state);
  }
}

// Helper function to split long text into chunks
function splitLongText(text, maxChars = 2000) {
  const chunks = [];
  let current = '';
  const lines = text.split('\n');
  
  for (const line of lines) {
    if ((current + line + '\n').length > maxChars) {
      if (current) chunks.push(current.trim());
      current = line + '\n';
    } else {
      current += line + '\n';
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

// ── CPU Fills & Season Readiness ─────────────────────────────
// Leagues may not fill all slots with human players.
// CPU fills mark unclaimed teams as CPU-controlled so the season can start.

/**
 * Check if a league has enough human members to start the season.
 * @param {object} state - Bot state
 * @param {string} leagueTypeId - League type to check
 * @returns {{ ready: boolean, humanCount: number, cpuCount: number, needed: number, totalSlots: number }}
 */
function checkSeasonReadiness(state, leagueTypeId) {
  const def = LEAGUE_TYPES[leagueTypeId];
  if (!def) return { ready: false, humanCount: 0, cpuCount: 0, needed: MIN_MEMBERS_TO_START, totalSlots: 0 };

  const reg = state.openTeamRegistry;
  const leagueTeams = reg.filter(t => (t.leagueId || null) === (leagueTypeId || null) || !t.leagueId);
  const claimed = leagueTeams.filter(t => !t.isOpen && !t.isCPU);
  const cpuFilled = leagueTeams.filter(t => t.isCPU);
  const humanCount = claimed.length;
  const cpuCount = cpuFilled.length;
  const needed = Math.max(0, MIN_MEMBERS_TO_START - humanCount);

  return {
    ready: humanCount >= MIN_MEMBERS_TO_START,
    humanCount,
    cpuCount,
    needed,
    totalSlots: def.teamCount,
    openSlots: leagueTeams.filter(t => t.isOpen).length,
  };
}

/**
 * Mark remaining open teams as CPU-controlled so season can proceed.
 * @param {object} state
 * @param {string} leagueTypeId
 * @returns {{ filled: number, teams: string[] }}
 */
function fillCPUTeams(state, leagueTypeId) {
  const reg = state.openTeamRegistry;
  const filled = [];
  for (const t of reg) {
    if (!t.isOpen) continue;
    if (leagueTypeId && t.leagueId && t.leagueId !== leagueTypeId) continue;
    t.isOpen = false;
    t.isCPU = true;
    t.ownerId = 'CPU';
    filled.push(t.displayTeam);
  }
  saveJsonDebounced('openTeamRegistry.json', reg);
  return { filled: filled.length, teams: filled };
}

/**
 * Release all CPU fills back to open status.
 * @param {object} state
 * @param {string} leagueTypeId - optional, null = all leagues
 * @returns {number} count released
 */
function releaseCPUTeams(state, leagueTypeId) {
  let count = 0;
  for (const t of state.openTeamRegistry) {
    if (!t.isCPU) continue;
    if (leagueTypeId && t.leagueId && t.leagueId !== leagueTypeId) continue;
    t.isOpen = true;
    t.isCPU = false;
    t.ownerId = null;
    count++;
  }
  saveJsonDebounced('openTeamRegistry.json', state.openTeamRegistry);
  return count;
}

// ── Default Configuration Snapshots ──────────────────────────
// Stores default values so commissioners can reset customizations.

/**
 * Save the current config as the "defaults" snapshot.
 * Call this right after initial setup so we have a baseline.
 */
function saveConfigDefaults(state) {
  state.leagueConfig._defaults = {
    rulesText: state.leagueConfig.rulesText,
    leagueName: state.leagueConfig.leagueName,
    leagueTypeId: state.leagueConfig.leagueTypeId,
    game: state.leagueConfig.game,
    seasonType: state.leagueConfig.seasonType,
    seasonWeeks: state.leagueConfig.seasonWeeks,
    savedAt: Date.now(),
  };
  // Save category/channel names at time of setup
  state.leagueConfig._defaults.categoryNames = (state.leagueConfig.builtCategoryIds || []).map(id => {
    return id; // IDs are stable — names may change
  });
  saveJsonDebounced('leagueConfig.json', state.leagueConfig);
}

/**
 * Reset specific config fields back to their defaults.
 * @param {object} state
 * @param {string[]} fields - which fields to reset: 'rules', 'league-name', 'all'
 * @returns {{ reset: string[], skipped: string[] }}
 */
function resetToDefaults(state, fields) {
  const defaults = state.leagueConfig._defaults;
  if (!defaults) return { reset: [], skipped: ['No defaults saved — run /setup-league first'] };

  const resetList = [];
  const skipped = [];
  const all = fields.includes('all');

  if (all || fields.includes('rules')) {
    if (defaults.rulesText) { state.leagueConfig.rulesText = defaults.rulesText; resetList.push('rules'); }
    else skipped.push('rules (no default saved)');
  }
  if (all || fields.includes('league-name')) {
    state.leagueConfig.leagueName = defaults.leagueName || null;
    resetList.push('league-name');
  }
  if (all || fields.includes('season')) {
    if (defaults.seasonType) { state.leagueConfig.seasonType = defaults.seasonType; state.leagueConfig.seasonWeeks = defaults.seasonWeeks; resetList.push('season'); }
    else skipped.push('season (no default saved)');
  }

  if (resetList.length) {
    state.leagueConfig.rulesUpdatedAt = Date.now();
    saveJsonDebounced('leagueConfig.json', state.leagueConfig);
  }
  return { reset: resetList, skipped };
}

module.exports = {
  LEAGUE_TYPES,
  SHARED_RULES,
  MIN_MEMBERS_TO_START,
  getSeasonWeeks,
  generateSchedule,
  buildLeagueStructure,
  buildSimplifiedLeagueStructure,
  deleteLeagueStructure,
  postFullSchedule,
  buildStandingsEmbed,
  refreshStandings,
  recordGameResult,
  reverseGameResult,
  generateGameArticle,
  sendSetupWizard,
  handleSetupInteraction,
  handleProAmTeamModal,
  showProAmTeamEntry,
  splitLongText,
  checkSeasonReadiness,
  fillCPUTeams,
  releaseCPUTeams,
  saveConfigDefaults,
  resetToDefaults,
};