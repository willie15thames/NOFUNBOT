/*
 * NAVIGATION HEADER
 * FILE: src/services/teamSeedService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
const { DEFAULT_OPEN_TEAMS } = require('../config/teams');
const { saveJsonDebounced } = require('../storage/jsonStore');

const NBA_2K_TEAMS = [
  'Atlanta Hawks','Boston Celtics','Brooklyn Nets','Charlotte Hornets','Chicago Bulls',
  'Cleveland Cavaliers','Dallas Mavericks','Denver Nuggets','Detroit Pistons','Golden State Warriors',
  'Houston Rockets','Indiana Pacers','LA Clippers','Los Angeles Lakers','Memphis Grizzlies',
  'Miami Heat','Milwaukee Bucks','Minnesota Timberwolves','New Orleans Pelicans','New York Knicks',
  'Oklahoma City Thunder','Orlando Magic','Philadelphia 76ers','Phoenix Suns','Portland Trail Blazers',
  'Sacramento Kings','San Antonio Spurs','Toronto Raptors','Utah Jazz','Washington Wizards'
];

function buildCustomSlots(def, leagueId, leagueName) {
  const count = Number(def?.teamCount) || 0;
  const format = def?.formatLabel ? `${def.formatLabel} ` : '';
  return Array.from({ length: count }, (_, idx) => ({
    baseTeam: `${format}Slot ${idx + 1}`.trim(),
    displayTeam: `${format}Open Slot ${idx + 1}`.trim(),
    logoUrl: null,
    isOpen: true,
    ownerId: null,
    leagueId,
    leagueName,
    isCPU: false,
    timezone: null,
    isCustomSlot: true,
  }));
}

const NCAA_TEAMS = [
  'Alabama Crimson Tide','Auburn Tigers','Clemson Tigers','Colorado Buffaloes','Florida Gators',
  'Florida State Seminoles','Georgia Bulldogs','LSU Tigers','Miami Hurricanes','Michigan Wolverines',
  'Michigan State Spartans','Minnesota Golden Gophers','Nebraska Cornhuskers','Notre Dame Fighting Irish','Ohio State Buckeyes',
  'Oklahoma Sooners','Oklahoma State Cowboys','Ole Miss Rebels','Oregon Ducks','Penn State Nittany Lions',
  'South Carolina Gamecocks','Tennessee Volunteers','Texas Longhorns','Texas A&M Aggies','TCU Horned Frogs',
  'UCF Knights','UCLA Bruins','USC Trojans','Utah Utes','Washington Huskies',
  'Wisconsin Badgers','North Carolina Tar Heels'
];

function buildSeedTeamsForLeague(def, leagueId, leagueName) {
  const game = String(def?.game || '').toLowerCase();
  if (def?.isCustom && Number(def?.teamCount) > 0) {
    return buildCustomSlots(def, leagueId, leagueName);
  }
  if (game === 'madden') {
    return DEFAULT_OPEN_TEAMS.map(t => ({ ...t, isOpen:true, ownerId:null, leagueId, leagueName, isCPU:false, timezone:null }));
  }
  if (game === 'nba2k') {
    return NBA_2K_TEAMS.map(name => ({ baseTeam:name, displayTeam:name, logoUrl:null, isOpen:true, ownerId:null, leagueId, leagueName, isCPU:false, timezone:null }));
  }
  if (game === 'ncaa') {
    return NCAA_TEAMS.map(name => ({ baseTeam:name, displayTeam:name, logoUrl:null, isOpen:true, ownerId:null, leagueId, leagueName, isCPU:false, timezone:null }));
  }
  return [];
}

function seedLeagueTeams(state, def, league) {
  if (!state || !def || !league?.id) return { seeded: 0, leagueId: league?.id || null };
  const reg = Array.isArray(state.openTeamRegistry) ? state.openTeamRegistry : [];
  const existing = reg.filter(t => String(t.leagueId || '') === String(league.id));
  if (existing.length) return { seeded: 0, skipped: existing.length, leagueId: league.id };
  const seeds = buildSeedTeamsForLeague(def, league.id, league.leagueName || def.label);
  for (const s of seeds) reg.push(s);
  saveJsonDebounced('openTeamRegistry.json', reg);
  return { seeded: seeds.length, leagueId: league.id };
}

module.exports = { seedLeagueTeams, buildSeedTeamsForLeague };
