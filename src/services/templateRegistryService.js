/*
 * NAVIGATION HEADER
 * FILE: src/services/templateRegistryService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

function cat(name, channels) { return { name, channels }; }
function ch(name, readOnly = false) { return [name, readOnly]; }

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const TEMPLATE_REGISTRY = {
  general: {
    key: 'general',
    name: 'General / Simple Server',
    summary: 'A lightweight starting point with only the essentials for a simple community.',
    leagueFriendly: false,
    subservers: ['chat','announcements','events'],
    guideBullets: [
      'Keep the layout light: one main chat lane, one information lane, and only add more when the community needs it.',
      'Use a simple subtemplate when you want purpose-specific naming without a large channel tree.',
      'League tools stay out of the way unless a competition module is added later.'
    ],
    joinHelp: 'Start in general chat and check announcements or the server guide for anything important.',
    aiHints: ['General/simple template: keep guidance concise and avoid inventing extra structure.'],
    quickAnswers: { whatisthis: 'This is a lightweight general community server with a simple channel layout.' },
    categories: [
      cat('💬 Community', [ch('general-chat'), ch('announcements', true)])
    ],
    subtemplates: {
      chat: { name: 'Simple Community Chat', summary: 'Just the basics for conversation, announcements, and member updates.', subservers:['chat','announcements'], categories:[cat('💬 Community', [ch('general-chat'), ch('announcements', true)])], aiHints:['Simple community subtemplate: keep navigation and conversation lightweight.'] },
      gaming: { name: 'Simple Gaming', summary: 'A small gaming setup with chat, LFG, and clips without a complex league layout.', subservers:['game-chat','lfg','clips'], categories:[cat('🎮 Gaming', [ch('game-chat'), ch('looking-for-group'), ch('clips-and-highlights')])], aiHints:['Simple gaming subtemplate: focus on game chat, LFG, and clips.'] },
      sports: { name: 'Simple Sports', summary: 'A compact sports community with general talk, scores, and watch-party planning.', subservers:['sports-chat','scores','watch-party'], categories:[cat('🏟 Sports', [ch('sports-chat'), ch('scores', true), ch('watch-party-planning')])], aiHints:['Simple sports subtemplate: focus on sports chat, scores, and watch parties.'] },
      study: { name: 'Simple Study Group', summary: 'A compact learning setup with questions, resources, and study chat.', subservers:['questions','resources','study'], categories:[cat('📚 Study', [ch('questions'), ch('resources', true), ch('study-chat')])], aiHints:['Simple study subtemplate: answer clearly and prioritize questions and resources.'] },
      watchparty: { name: 'Simple Watch Party', summary: 'A lightweight media setup for scheduling, live reactions, and recaps.', subservers:['schedule','live','recap'], categories:[cat('📺 Watch Party', [ch('watch-schedule', true), ch('live-reactions'), ch('recap-chat')])], aiHints:['Simple watch-party subtemplate: focus on schedules, live reactions, and recaps.'] },
    },
    usabilityFlows: ['timezone-onboarding','wizard-build']
  },
  gaming: {
    key: 'gaming',
    name: 'Gaming Server',
    summary: 'Game chat, squad-up, clips, events, and optional league operations.',
    leagueFriendly: true,
    subservers: ['match-hub', 'lfg', 'clips', 'voice'],
    guideBullets: [
      'Use game chat, squad-up, and live-ops lanes for gameplay coordination.',
      'League tools only apply if staff intentionally enables a competition module.',
      'Clips, highlights, and LFG traffic belong in gaming lanes, not read-only info lanes.'
    ],
    joinHelp: 'Use the gaming lanes first. Competition or league intake only matters if staff explicitly enables it later.',
    aiHints: [
      'Gaming template: discuss gameplay, roles, clips, voice chat, LFG, events, and server-specific game modes.',
      'If no competition module exists, answer gameplay questions directly instead of forcing league commands.'
    ],
    quickAnswers: {
      voicechat: 'Yep. Gaming servers can support voice rooms, squad-up lanes, and optional competition coordination.',
      whatisthis: 'This is a gaming-first server. Think game chat, squad-up, highlights, and optional competitive modules.'
    },
    categories: [
      cat('💬 Community', [ch('general-chat'), ch('polls', true), ch('clips-and-highlights'), ch('looking-for-group')]),
      cat('🎮 Gaming Hub', [ch('game-chat'), ch('squad-up'), ch('match-hub'), ch('voice-room-info', true)])],
    subtemplates: {
      cod: {
        name: 'Call of Duty Ops',
        summary: 'Squad finding, loadouts, clips, comp nights, and ranked chatter for Call of Duty crews.',
        subservers: ['warzone', 'ranked', 'loadouts', 'clips'],
        categories: [
          cat('💬 Deployment Chat', [ch('general-chat'), ch('party-up'), ch('loadouts-and-metas'), ch('clips-and-highlights')]),
          cat('🎯 COD Ops', [ch('warzone-lfg'), ch('ranked-grind'), ch('scrim-planning'), ch('patch-watch', true)])],
        aiHints: ['COD subtemplate: prioritize squad-up, loadouts, maps, ranked, Warzone, clips, and patch chatter.'],
      },
      gta: {
        name: 'GTA Crew City',
        summary: 'Crews, heists, races, RP chatter, and clips for GTA communities.',
        subservers: ['crews', 'heists', 'races', 'rp'],
        categories: [
          cat('💬 Community', [ch('general-chat'), ch('crew-recruiting'), ch('heist-board'), ch('clips-and-chaos')]),
          cat('🚗 GTA City', [ch('rp-talk'), ch('races-and-meets'), ch('money-runs'), ch('server-updates', true)])],
        aiHints: ['GTA subtemplate: focus on crews, heists, RP, races, events, and clip-worthy chaos.'],
      },
      sports: {
        name: 'Sports Gaming League',
        summary: 'Competitive sports gaming with teams, schedules, standings, and watch-party chatter.',
        subservers: ['scores', 'teams', 'fantasy', 'watch-party'],
        categories: [
          cat('🏟 Sports Gaming', [ch('general-chat'), ch('team-talk'), ch('scores-and-standings', true), ch('schedule-board', true)]),
          cat('📺 Watch & Fantasy', [ch('watch-party-planning'), ch('fantasy-talk'), ch('clips-and-highlights'), ch('match-lobby')])],
        aiHints: ['Sports gaming subtemplate: discuss teams, matchups, standings, fantasy, and watch parties.'],
      },
      apex: {
        name: 'Apex Ranked Ops',
        summary: 'Battle royale comms, ranked squads, legends, rotations, and clip reviews for Apex groups.',
        subservers: ['ranked', 'lfg', 'legends', 'clips'],
        categories: [
          cat('🪂 Dropship', [ch('general-chat'), ch('squad-up'), ch('legend-talk'), ch('clip-review')]),
          cat('🏁 Ranked Run', [ch('ranked-grind'), ch('scrim-planning'), ch('map-rotations'), ch('patch-watch', true)])],
        aiHints: ['Apex subtemplate: focus on ranked squads, legends, rotations, clips, and battle royale comms.'],
      },
      minecraft: {
        name: 'Minecraft Realm',
        summary: 'Survival builds, realm updates, mod packs, screenshots, and server coordination for Minecraft communities.',
        subservers: ['realm', 'builds', 'mods', 'screenshots'],
        categories: [
          cat('⛏ Minecraft Realm', [ch('general-chat'), ch('realm-chat'), ch('build-showcase'), ch('mod-pack-talk')]),
          cat('🌲 Survival Board', [ch('seed-and-spawn'), ch('resource-runs'), ch('events-and-raids'), ch('server-status', true)])],
        aiHints: ['Minecraft subtemplate: discuss builds, realms, survival runs, mods, screenshots, and events.'],
      },
      roblox: {
        name: 'Roblox Studio Hub',
        summary: 'Experience planning, squad-up, creator talk, and game-night chatter for Roblox communities.',
        subservers: ['experiences', 'studio', 'squad-up', 'events'],
        categories: [
          cat('🧱 Roblox Hub', [ch('general-chat'), ch('experience-talk'), ch('studio-help'), ch('squad-up')]),
          cat('🎉 Event Queue', [ch('game-night'), ch('creator-showcase'), ch('group-updates', true), ch('clips-and-highlights')])],
        aiHints: ['Roblox subtemplate: focus on experiences, studio help, creator talk, squads, and event nights.'],
      },
      mmo: {
        name: 'MMO Raid Hall',
        summary: 'Guild coordination, raid signups, class talk, and loot planning for MMO communities.',
        subservers: ['guild', 'raids', 'classes', 'loot'],
        categories: [
          cat('🛡 Guild Hall', [ch('general-chat'), ch('guild-recruitment'), ch('class-talk'), ch('loot-discussion')]),
          cat('🐉 Raid Planner', [ch('raid-signups'), ch('boss-strats'), ch('event-calendar', true), ch('patch-watch', true)])],
        aiHints: ['MMO subtemplate: focus on guilds, raids, classes, loot, and event planning.'],
      },
      fighter: {
        name: 'Fighting Game Corner',
        summary: 'Sets, frame data, matchup notes, and bracket chatter for fighting game communities.',
        subservers: ['sets', 'matchups', 'tech', 'brackets'],
        categories: [
          cat('🥊 Matchup Lab', [ch('general-chat'), ch('set-finder'), ch('matchup-talk'), ch('tech-and-combos')]),
          cat('🏆 Bracket Board', [ch('tournament-signups'), ch('vod-review'), ch('tier-list-talk'), ch('event-updates', true)])],
        aiHints: ['Fighting game subtemplate: discuss sets, matchups, frame data, brackets, and combo tech.'],
      },
      racing: {
        name: 'Racing Grid',
        summary: 'Lobbies, tuning, clips, and event races for sim and arcade racing crews.',
        subservers: ['lobbies', 'tunes', 'events', 'clips'],
        categories: [
          cat('🏎 Grid Chat', [ch('general-chat'), ch('lobby-finder'), ch('tuning-talk'), ch('clips-and-highlights')]),
          cat('🏁 Event Circuit', [ch('race-calendar', true), ch('results-board', true), ch('car-showcase'), ch('crew-updates')])],
        aiHints: ['Racing subtemplate: focus on lobbies, tuning, events, results, and clips.'],
      },
      mobile: {
        name: 'Mobile Gaming Club',
        summary: 'Squad-up, metas, updates, and event chatter for mobile-first gaming communities.',
        subservers: ['squads', 'metas', 'events', 'updates'],
        categories: [
          cat('📱 Mobile Hub', [ch('general-chat'), ch('squad-up'), ch('meta-talk'), ch('event-chat')]),
          cat('🧭 Live Ops', [ch('patch-watch', true), ch('clan-recruiting'), ch('clips-and-highlights'), ch('help-and-guides')])],
        aiHints: ['Mobile gaming subtemplate: discuss squads, metas, patch updates, clans, and events.'],
      },
      variety: {
        name: 'Variety Gaming Lounge',
        summary: 'Multi-game chat, co-op nights, clip dumps, and rotating game sessions.',
        subservers: ['rotations', 'lfg', 'clips', 'events'],
        categories: [
          cat('🎲 Variety Lounge', [ch('general-chat'), ch('what-are-we-playing'), ch('looking-for-group'), ch('clips-and-highlights')]),
          cat('🗓 Game Nights', [ch('event-calendar', true), ch('co-op-planning'), ch('game-recommendations'), ch('patch-watch', true)])],
        aiHints: ['Variety gaming subtemplate: focus on rotating games, co-op nights, recommendations, and LFG.'],
      },
      esports: {
        name: 'Esports Team HQ',
        summary: 'Roster management, scrims, vod review, and tournament prep for organized teams.',
        subservers: ['roster', 'scrims', 'vod', 'tournaments'],
        categories: [
          cat('🧠 Team Ops', [ch('general-chat'), ch('roster-room'), ch('scrim-planning'), ch('vod-review')]),
          cat('🏅 Tournament Desk', [ch('bracket-watch'), ch('match-prep'), ch('announcement-board', true), ch('results-board', true)])],
        aiHints: ['Esports subtemplate: discuss rosters, scrims, vod review, tournaments, and match prep.'],
      },
    },
    usabilityFlows: ['timezone-onboarding','wizard-build','gif-replies','competition-intake','data-ingest']
  },
  sports: {
    key: 'sports',
    name: 'Sports Server',
    summary: 'Sports talk, scores, schedules, fantasy chatter, fan zones, and event planning.',
    leagueFriendly: true,
    subservers: ['scores', 'teams', 'fantasy', 'watch-party'],
    guideBullets: [
      'Use game-day, scores, and standings lanes for live sports traffic.',
      'Sports server logic is broader than a single franchise or league.',
      'Fantasy, clips, and team talk should stay in sports lanes instead of read-only info channels.'
    ],
    joinHelp: 'Browse sports channels first. If staff enables a season or league module, the intake flow will open then.',
    aiHints: [
      'Sports template: prioritize scores, standings, fantasy, schedules, clips, teams, and live discussion.',
      'Do not assume every sports server is strictly a Madden franchise server.'
    ],
    quickAnswers: {
      whatisthis: 'This is a sports-first server for scores, team talk, fantasy, watch parties, and optional competition spaces.'
    },
    categories: [
      cat('🏟 Sports Central', [ch('general-chat'), ch('game-day'), ch('scores-and-standings', true), ch('team-talk'), ch('polls', true)]),
      cat('📺 Watch & Fantasy', [ch('watch-party-planning'), ch('fantasy-talk'), ch('clips-and-highlights'), ch('schedule-board', true)])],
    subtemplates: {
      nfl: {
        name: 'NFL Sunday Hub',
        summary: 'NFL schedules, scores, fantasy, red-zone reactions, and team rivalry lanes.',
        subservers: ['nfl', 'fantasy', 'red-zone', 'watch-party'],
        categories: [
          cat('🏈 NFL HQ', [ch('general-chat'), ch('gameday-redzone'), ch('nfl-scores', true), ch('team-talk')]),
          cat('📺 Watch & Fantasy', [ch('fantasy-talk'), ch('watch-party-planning'), ch('power-rankings'), ch('trade-machine')])],
        aiHints: ['NFL subtemplate: discuss weekly matchups, fantasy, red zone, teams, and Sunday watch parties.'],
      },
      nba: {
        name: 'NBA Nightly Run',
        summary: 'NBA game nights, standings, clips, fantasy hoops, and player debates.',
        subservers: ['nba', 'fantasy', 'highlights', 'watch-party'],
        categories: [
          cat('🏀 NBA Central', [ch('general-chat'), ch('hoops-night'), ch('scores-and-standings', true), ch('player-debates')]),
          cat('🎥 Highlights & Fantasy', [ch('highlight-tape'), ch('fantasy-hoops'), ch('watch-party-planning'), ch('trade-talk')])],
        aiHints: ['NBA subtemplate: focus on game nights, standings, player debates, fantasy hoops, and highlight culture.'],
      },
      soccer: {
        name: 'Football Worldwide',
        summary: 'Soccer fixtures, transfer chatter, supporter zones, and match watch coordination.',
        subservers: ['fixtures', 'transfers', 'supporters', 'watch-party'],
        categories: [
          cat('⚽ Matchday', [ch('general-chat'), ch('fixtures-board', true), ch('matchday-chat'), ch('supporter-sections')]),
          cat('🌍 World Football', [ch('transfer-talk'), ch('watch-party-planning'), ch('goal-clips'), ch('power-rankings')])],
        aiHints: ['Soccer subtemplate: discuss fixtures, supporters, transfers, tournaments, and matchday watch parties.'],
      },
      mlb: {
        name: 'MLB Dugout',
        summary: 'Baseball game threads, scores, fantasy, and trade chatter for MLB communities.',
        subservers: ['mlb', 'fantasy', 'scores', 'watch-party'],
        categories: [
          cat('⚾ MLB Dugout', [ch('general-chat'), ch('game-thread'), ch('mlb-scores', true), ch('team-talk')]),
          cat('📺 Fantasy & Trades', [ch('fantasy-baseball'), ch('watch-party-planning'), ch('trade-block'), ch('power-rankings')])],
        aiHints: ['MLB subtemplate: discuss game threads, scores, team talk, fantasy baseball, and trades.'],
      },
      college: {
        name: 'College Sports Campus',
        summary: 'Campus sports chatter, rivalry talk, rankings, and game-day coordination.',
        subservers: ['rankings', 'rivalries', 'gameday', 'watch-party'],
        categories: [
          cat('🎓 Campus Sports', [ch('general-chat'), ch('rankings-watch'), ch('rivalry-row'), ch('gameday-chat')]),
          cat('📣 Watch & Recruiting', [ch('watch-party-planning'), ch('commitment-talk'), ch('upset-alerts'), ch('polls', true)])],
        aiHints: ['College sports subtemplate: discuss rankings, rivalries, game days, commitments, and watch parties.'],
      },
      fantasy: {
        name: 'Fantasy Sports War Room',
        summary: 'Draft prep, waiver wire, lineup debate, and trade chatter for fantasy players.',
        subservers: ['draft', 'lineups', 'waivers', 'trades'],
        categories: [
          cat('📋 War Room', [ch('general-chat'), ch('draft-prep'), ch('lineup-advice'), ch('waiver-wire')]),
          cat('🤝 Trade Desk', [ch('trade-talk'), ch('buy-low-sell-high'), ch('injury-watch', true), ch('power-rankings')])],
        aiHints: ['Fantasy sports subtemplate: focus on drafts, waivers, trades, lineups, and rankings.'],
      },
      betting: {
        name: 'Betting Talk Board',
        summary: 'Picks chatter, odds discussion, and live sweat rooms for sports betting talk.',
        subservers: ['picks', 'odds', 'live', 'results'],
        categories: [
          cat('🎲 Betting Board', [ch('general-chat'), ch('pick-talk'), ch('odds-and-lines'), ch('live-sweats')]),
          cat('📊 Recap Desk', [ch('results-board', true), ch('bankroll-talk'), ch('parlay-corner'), ch('schedule-board', true)])],
        aiHints: ['Betting talk subtemplate: discuss picks, odds, live sweats, bankrolls, and recap boards.'],
      },
      fanhub: {
        name: 'Team Fan Hub',
        summary: 'One-team fan chatter, game-day talk, memes, and rivalry content.',
        subservers: ['team', 'gameday', 'memes', 'watch-party'],
        categories: [
          cat('📣 Fan Hub', [ch('general-chat'), ch('team-talk'), ch('gameday-chat'), ch('fan-memes')]),
          cat('🎥 Watch Party', [ch('watch-party-planning'), ch('rivalry-talk'), ch('highlight-tape'), ch('announcements', true)])],
        aiHints: ['Team fan hub subtemplate: discuss one-team fandom, memes, game days, rivalries, and highlights.'],
      },
      watchalong: {
        name: 'Watch Along Club',
        summary: 'Live reactions, watch scheduling, and recap chatter around sports broadcasts.',
        subservers: ['live', 'schedule', 'recap', 'clips'],
        categories: [
          cat('📺 Watch Along', [ch('general-chat'), ch('live-reactions'), ch('watch-party-planning'), ch('broadcast-schedule', true)]),
          cat('📝 Recap', [ch('postgame-recap'), ch('clip-dump'), ch('prediction-board'), ch('polls', true)])],
        aiHints: ['Watch along subtemplate: focus on live reactions, schedules, recaps, and clip sharing.'],
      },
    },
    usabilityFlows: ['timezone-onboarding','event-scheduling','gif-replies','wizard-build','data-ingest']
  },
  educational: {
    key: 'educational',
    name: 'Educational Server',
    summary: 'Resources, questions, study halls, office hours, and project collaboration.',
    leagueFriendly: false,
    subservers: ['resources', 'questions', 'study-hall', 'projects'],
    guideBullets: [
      'Resources are read-only; questions and study-hall are the live discussion lanes.',
      'Structured learning and project collaboration matter more than banter here.',
      'Templates can still share moderation, polls, onboarding, and AI builder logic with other server styles.'
    ],
    joinHelp: 'Browse resources, ask questions, and use study-hall or project lanes.',
    aiHints: [
      'Educational template: answer clearly, teach directly, and point users to resources, questions, and projects.',
      'Avoid pushing competition commands unless the member explicitly asks about them.'
    ],
    quickAnswers: { whatisthis: 'This is an educational-first server built around resources, questions, and study rooms.' },
    categories: [
      cat('📚 Learning', [ch('resources', true), ch('questions'), ch('study-hall'), ch('projects'), ch('office-hours', true)]),
      cat('🧪 Workshops & Labs', [ch('assignments', true), ch('lab-help'), ch('project-showcase'), ch('study-groups')]),
      cat('💬 Community', [ch('general-chat'), ch('polls', true)])],
    subtemplates: {
      coding: {
        name: 'Coding Campus',
        summary: 'Code help, project labs, debugging, and build showcases.',
        subservers: ['code-help', 'projects', 'debugging', 'resources'],
        categories: [cat('💻 Code Lab', [ch('questions'), ch('debugging-help'), ch('projects'), ch('resource-drop', true)])],
        aiHints: ['Coding subtemplate: focus on debugging, project builds, code help, and resources.'],
      },
      cybersecurity: {
        name: 'Cyber Range',
        summary: 'Threat intel, labs, certs, blue-team notes, and research collaboration.',
        subservers: ['labs', 'threat-intel', 'certs', 'research'],
        categories: [cat('🛡 Cyber Range', [ch('threat-intel'), ch('lab-help'), ch('cert-talk'), ch('research-notes')])],
        aiHints: ['Cybersecurity subtemplate: focus on labs, threat intel, certifications, blue team, and research.' ],
      },
      language: {
        name: 'Language Exchange',
        summary: 'Practice rooms, study groups, vocabulary swaps, and cultural exchange.',
        subservers: ['practice', 'study', 'resources', 'exchange'],
        categories: [cat('🗣 Language Hub', [ch('practice-chat'), ch('study-groups'), ch('resource-drop', true), ch('culture-exchange')])],
        aiHints: ['Language subtemplate: focus on practice, study groups, vocabulary help, and exchange.'],
      },
      studygroup: {
        name: 'Study Group Hall',
        summary: 'Group study rooms, accountability check-ins, and resource sharing.',
        subservers: ['study', 'resources', 'accountability', 'questions'],
        categories: [cat('📝 Study Group', [ch('general-chat'), ch('study-hall'), ch('resource-drop', true), ch('accountability-check-in')])],
        aiHints: ['Study group subtemplate: focus on study sessions, accountability, and resource sharing.'],
      },
      testprep: {
        name: 'Test Prep Lab',
        summary: 'Exam strategy, practice sets, and accountability support for learners.',
        subservers: ['practice', 'strategy', 'resources', 'reviews'],
        categories: [cat('🧪 Test Prep', [ch('general-chat'), ch('practice-questions'), ch('strategy-talk'), ch('resource-drop', true)])],
        aiHints: ['Test prep subtemplate: discuss practice sets, strategies, resources, and review plans.'],
      },
      research: {
        name: 'Research Workshop',
        summary: 'Paper planning, citations, findings, and peer review collaboration.',
        subservers: ['papers', 'sources', 'peer-review', 'findings'],
        categories: [cat('🔬 Research Workshop', [ch('general-chat'), ch('paper-planning'), ch('source-board', true), ch('peer-review')])],
        aiHints: ['Research subtemplate: focus on papers, sources, findings, and peer review.'],
      },
      bookstudy: {
        name: 'Book Study Circle',
        summary: 'Reading schedules, chapter threads, reflections, and study notes.',
        subservers: ['reading', 'notes', 'questions', 'schedule'],
        categories: [cat('📖 Book Study', [ch('general-chat'), ch('reading-schedule', true), ch('chapter-chat'), ch('study-notes')])],
        aiHints: ['Book study subtemplate: discuss chapters, schedules, notes, and reflections.'],
      },
    },
    usabilityFlows: ['timezone-onboarding','manual-lookup','resource-guide','wizard-build','data-ingest']
  },
  movie: {
    key: 'movie',
    name: 'Movie / Watch Party Server',
    summary: 'Watch parties, reviews, release calendars, spoilers, and cast discussion.',
    leagueFriendly: false,
    subservers: ['watch-party', 'reviews', 'spoilers', 'calendar'],
    guideBullets: [
      'Use release-calendar and watch-party-planning for scheduled viewing.',
      'Reviews, theories, and spoiler lanes stay separate so people do not get plot-bombed.',
      'This template shares onboarding and moderation logic with other server types, but not competition-first assumptions.'
    ],
    joinHelp: 'Check the release calendar, pick the right spoiler lane, and use watch-party-planning for live events.',
    aiHints: [
      'Movie template: prioritize releases, reviews, spoilers, theories, cast, scenes, and event scheduling.',
      'Do not talk like this is automatically a sports league server.'
    ],
    quickAnswers: { whatisthis: 'This is a movie and watch-party style server built around releases, reviews, spoilers, and live viewing.' },
    categories: [
      cat('🎬 Movie HQ', [ch('release-calendar', true), ch('watch-party-planning'), ch('reviews'), ch('recommendations')]),
      cat('🍿 Spoilers & Deep Dives', [ch('spoilers'), ch('theories'), ch('scene-breakdown'), ch('cast-talk')]),
      cat('💬 Community', [ch('general-chat'), ch('polls', true), ch('memes-and-clips')])],
    subtemplates: {
      movies: {
        name: 'Cinema Club',
        summary: 'Movie nights, reviews, directors, and box-office chatter.',
        subservers: ['watch-party', 'reviews', 'directors', 'calendar'],
        categories: [cat('🎥 Cinema Club', [ch('watch-party-planning'), ch('reviews'), ch('director-talk'), ch('release-calendar', true)])],
        aiHints: ['Movies subtemplate: focus on film releases, reviews, directors, performances, and watch nights.'],
      },
      anime: {
        name: 'Anime Watch Hub',
        summary: 'Episode drops, arcs, characters, openings, and spoiler-safe anime discussion.',
        subservers: ['episodes', 'spoilers', 'openings', 'watch-party'],
        categories: [cat('🌸 Anime Watch', [ch('episode-talk'), ch('spoilers'), ch('character-rankings'), ch('opening-and-ending-hall')])],
        aiHints: ['Anime watch subtemplate: discuss episodes, arcs, characters, openings, endings, and spoiler-safe reactions.'],
      },
      wrestling: {
        name: 'Wrestling Watch Room',
        summary: 'Shows, promos, match cards, and live reaction threads for wrestling fans.',
        subservers: ['shows', 'promos', 'match-cards', 'watch-party'],
        categories: [cat('🤼 Wrestling Watch', [ch('show-night'), ch('promo-classics'), ch('match-cards'), ch('watch-party-planning')])],
        aiHints: ['Wrestling subtemplate: focus on shows, promos, match cards, belts, and live reactions.'],
      },
    },
    usabilityFlows: ['timezone-onboarding','event-scheduling','manual-lookup','gif-replies','wizard-build']
  },
  community: {
    key: 'community', name: 'Community Hangout', summary: 'Casual social channels, clubs, and polls.', leagueFriendly: false,
    subservers: ['social', 'media', 'polls'],
    guideBullets: ['General chat, introductions, media-share, and off-topic are the main lanes here.','This template is more social than competition-driven.','Polls and casual engagement matter more here than rigid workflow.'],
    joinHelp: 'Use the social channels first. Extra modules can be added later without rebuilding the server.',
    aiHints: ['Community template: prioritize social conversation, introductions, and casual help.'],
    quickAnswers: { whatisthis: 'This server is set up more like a social hangout than a hard competition hub.' },
    subtemplates: {
      friendgroup: { name: 'Friend Group House', summary: 'Inside jokes, daily chat, plans, and media drops for close-knit circles.', subservers:['chat','plans','media','memes'], categories:[cat('🏠 House Chat', [ch('general-chat'), ch('daily-chat'), ch('plans-and-links'), ch('media-dump')])], aiHints:['Friend group subtemplate: casual hangout energy, plans, jokes, and shared media.'] },
      memehub: { name: 'Meme Hub', summary: 'Memes, reaction images, and joke threads with light social chatter.', subservers:['memes','reactions','clips','hangout'], categories:[cat('😂 Meme Hub', [ch('general-chat'), ch('memes-only'), ch('reaction-dump'), ch('clip-spam')])], aiHints:['Meme hub subtemplate: keep things playful, image-heavy, and social.'] },
      chill: { name: 'Chill Lounge', summary: 'Low-pressure chat, late-night talk, and relaxed community check-ins.', subservers:['chat','night','music','vc'], categories:[cat('🌙 Chill Lounge', [ch('general-chat'), ch('night-owls'), ch('music-share'), ch('vc-plans')])], aiHints:['Chill lounge subtemplate: relaxed, social, and low-pressure conversation.'] },
      debate: { name: 'Debate Corner', summary: 'Structured hot takes, arguments, and topic-based discussion threads.', subservers:['debates','topics','polls','recap'], categories:[cat('🗣 Debate Corner', [ch('general-chat'), ch('hot-takes'), ch('debate-stage'), ch('polls', true)])], aiHints:['Debate subtemplate: encourage structured arguments, topic threads, and clear positions.'] },
      local: { name: 'Local Community Board', summary: 'Neighborhood plans, local events, and area-specific updates.', subservers:['events','food','alerts','buy-sell'], categories:[cat('📍 Local Board', [ch('general-chat'), ch('local-events'), ch('food-spots'), ch('community-alerts')])], aiHints:['Local community subtemplate: focus on nearby events, places, plans, and updates.'] },
      topic: { name: 'Topic Lounge', summary: 'Interest-based daily discussion with flexible social channels.', subservers:['chat','polls','shares','events'], categories:[cat('💬 Topic Lounge', [ch('general-chat'), ch('topic-of-the-day'), ch('share-corner'), ch('polls', true)])], aiHints:['Topic lounge subtemplate: general community discussion around shared interests.'] },
    },
    categories: [ cat('💬 Community', [ch('general-chat'), ch('polls', true), ch('introductions'), ch('media-share'), ch('off-topic')])],
    usabilityFlows: ['timezone-onboarding','manual-lookup','gif-replies','wizard-build']
  },
  creative: {
    key: 'creative', name: 'Creative Server', summary: 'Showcase, feedback, collabs, and inspiration.', leagueFriendly: false,
    subservers: ['showcase','feedback','collabs','resources'],
    guideBullets: ['Showcase is for posting work, feedback is for critique, and collabs is for team-ups.','Creative template values presentation, collaboration, and constructive feedback.','Competition setup is not the default assumption here.'],
    joinHelp: 'Use showcase and feedback first. Competition flow only applies if staff later enables one.',
    aiHints: ['Creative template: encourage showcasing, feedback, collabs, and inspiration.'],
    quickAnswers: { whatisthis: 'This one is set up as a creative hub: showcase, feedback, collabs, and resources.' },
    categories: [ cat('🎨 Creative Space', [ch('showcase'), ch('feedback'), ch('collabs'), ch('resources', true)]), cat('💬 Community', [ch('general-chat'), ch('polls', true), ch('off-topic')])],
    subtemplates: {
      art: { name: 'Art Studio', summary: 'Art drops, WIP feedback, references, and commission chatter.', subservers:['gallery','wip','commissions','resources'], categories:[cat('🖼 Art Studio', [ch('showcase'), ch('wip-feedback'), ch('references', true), ch('commission-corner')])], aiHints:['Art subtemplate: discuss artwork, feedback, WIPs, references, and commissions.'] },
      music: { name: 'Music Lab', summary: 'Releases, feedback, collabs, and production talk.', subservers:['releases','feedback','collabs','production'], categories:[cat('🎵 Music Lab', [ch('showcase'), ch('feedback'), ch('collabs'), ch('production-talk')])], aiHints:['Music subtemplate: discuss releases, feedback, collaborations, and production techniques.'] },
      writing: { name: 'Writers Room', summary: 'Drafts, critique, prompts, and worldbuilding.', subservers:['drafts','critique','prompts','worldbuilding'], categories:[cat('✍ Writers Room', [ch('showcase'), ch('feedback'), ch('prompt-lab'), ch('worldbuilding')])], aiHints:['Writing subtemplate: discuss drafts, critique, prompts, and worldbuilding.'] },
    },
    usabilityFlows: ['timezone-onboarding','manual-lookup','wizard-build']
  },
  professional: {
    key: 'professional', name: 'Professional Server', summary: 'Networking, jobs, resources, and structured discussion.', leagueFriendly: false,
    subservers: ['networking','jobs','resources'],
    guideBullets: ['Networking, jobs, and resources are the main lanes.','Tone here should lean cleaner and more professional by default.','Competition features only make sense if staff intentionally adds them.'],
    joinHelp: 'Use introductions, jobs, and resources before anything else.',
    aiHints: ['Professional template: keep answers efficient, useful, and networking-aware.'],
    quickAnswers: { whatisthis: 'This is a professional-style server for networking, jobs, and useful resources.' },
    categories: [ cat('💼 Networking', [ch('introductions'), ch('general-chat'), ch('jobs'), ch('resources', true)])],
    subtemplates: {
      career: { name: 'Career Network', summary: 'Jobs, referrals, resumes, and interview prep.', subservers:['jobs','referrals','resumes','interviews'], categories:[cat('💼 Career Network', [ch('introductions'), ch('jobs'), ch('resume-review'), ch('interview-prep')])], aiHints:['Career subtemplate: focus on jobs, referrals, resumes, and interview prep.'] },
      startup: { name: 'Startup Builder', summary: 'Founders, launches, operator talk, and build-in-public energy.', subservers:['founders','launches','operators','feedback'], categories:[cat('🚀 Startup Builder', [ch('founder-chat'), ch('launch-updates'), ch('operator-room'), ch('feedback')])], aiHints:['Startup subtemplate: focus on founders, launches, operators, and product feedback.'] },
      cybersecurity: { name: 'Cyber Ops Network', summary: 'Threat intel, jobs, certs, and operator discussion.', subservers:['threat-intel','jobs','certs','ops'], categories:[cat('🛡 Cyber Ops', [ch('threat-intel'), ch('jobs'), ch('cert-talk'), ch('operator-room')])], aiHints:['Cyber ops subtemplate: focus on jobs, threat intel, certifications, and operator discussion.'] },
      business: { name: 'Business Network', summary: 'Networking, deal flow, resources, and collaboration for business-minded communities.', subservers:['networking','resources','deals','projects'], categories:[cat('💼 Business Network', [ch('general-chat'), ch('networking'), ch('resource-drop', true), ch('deal-flow')])], aiHints:['Business subtemplate: focus on networking, resources, partnerships, and projects.'] },
      jobboard: { name: 'Opportunity Board', summary: 'Jobs, referrals, interview prep, and hiring announcements.', subservers:['jobs','referrals','prep','hiring'], categories:[cat('📌 Opportunity Board', [ch('general-chat'), ch('job-postings', true), ch('referral-requests'), ch('interview-prep')])], aiHints:['Job board subtemplate: focus on postings, referrals, hiring, and interview prep.'] },
      developers: { name: 'Developer Network', summary: 'Project talk, code help, tooling, and collaboration for builders.', subservers:['projects','code','tooling','collab'], categories:[cat('🧑‍💻 Dev Network', [ch('general-chat'), ch('project-talk'), ch('tooling-chat'), ch('code-help')])], aiHints:['Developer subtemplate: focus on projects, code, tooling, and collaboration.'] },
      designers: { name: 'Design Studio', summary: 'Feedback, showcases, resources, and workflow chat for designers.', subservers:['feedback','showcase','resources','workflow'], categories:[cat('🎨 Design Studio', [ch('general-chat'), ch('design-showcase'), ch('feedback-corner'), ch('resource-drop', true)])], aiHints:['Designer subtemplate: discuss showcases, feedback, workflows, and resources.'] },
      freelancers: { name: 'Freelancer Guild', summary: 'Client ops, pricing, workflows, and portfolio growth for freelancers.', subservers:['clients','pricing','ops','portfolio'], categories:[cat('🧾 Freelancer Guild', [ch('general-chat'), ch('client-talk'), ch('pricing-help'), ch('portfolio-room')])], aiHints:['Freelancer subtemplate: focus on clients, pricing, workflow, and portfolio growth.'] },
      finance: { name: 'Finance Circle', summary: 'Personal finance, business finance, and planning discussions.', subservers:['planning','budgeting','resources','discussion'], categories:[cat('💰 Finance Circle', [ch('general-chat'), ch('budget-talk'), ch('planning-room'), ch('resource-drop', true)])], aiHints:['Finance subtemplate: focus on budgeting, planning, resources, and discussion.'] },
    },
    usabilityFlows: ['timezone-onboarding','manual-lookup','wizard-build']
  },
  fandom: {
    key: 'fandom', name: 'Fandom Server', summary: 'Theories, fan art, spoilers, and fandom discussion.', leagueFriendly: false,
    subservers: ['theories','fan-art','spoilers'],
    guideBullets: ['Theories, fan-art, and spoiler lanes are the core structure here.','This template is fandom-first, not competition-first.','Respect spoiler boundaries and keep fan content in the right lane.'],
    joinHelp: 'Pick the right fandom lane: theories, fan-art, or spoilers.',
    aiHints: ['Fandom template: prioritize theories, lore, fan-art, spoilers, and fandom chat.'],
    quickAnswers: { whatisthis: 'This is a fandom-style server built around theories, spoilers, and fan content.' },
    categories: [ cat('🎭 Fandom', [ch('general-chat'), ch('theories'), ch('fan-art'), ch('spoilers')])],
    subtemplates: {
      anime: { name: 'Anime Fandom', summary: 'Lore, episodes, power rankings, and spoiler-safe anime chatter.', subservers:['lore','episodes','spoilers','fan-art'], categories:[cat('🌸 Anime Fandom', [ch('general-chat'), ch('theories'), ch('fan-art'), ch('spoilers')])], aiHints:['Anime fandom subtemplate: focus on episodes, lore, rankings, and spoiler-safe reactions.'] },
      starwars: { name: 'Star Wars Fandom', summary: 'Lore debates, shows, films, spoilers, and deep canon rabbit holes.', subservers:['lore','shows','spoilers','fan-art'], categories:[cat('🌌 Galaxy Far Away', [ch('general-chat'), ch('canon-and-legends'), ch('spoilers'), ch('fan-art')])], aiHints:['Star Wars subtemplate: discuss lore, canon, shows, films, and spoiler boundaries.'] },
      marvel: { name: 'Marvel Fandom', summary: 'Comics, MCU, theories, and spoiler-safe hero debates.', subservers:['mcu','comics','spoilers','fan-art'], categories:[cat('🦸 Marvel HQ', [ch('general-chat'), ch('mcu-talk'), ch('spoilers'), ch('fan-art')])], aiHints:['Marvel subtemplate: discuss comics, MCU, theories, spoilers, and character debates.'] },
      disney: { name: 'Disney Fandom', summary: 'Parks, films, songs, and family-friendly fandom chatter.', subservers:['parks','films','songs','fan-art'], categories:[cat('🏰 Disney Magic', [ch('general-chat'), ch('film-talk'), ch('parks-and-trips'), ch('fan-art')])], aiHints:['Disney subtemplate: discuss films, parks, music, and fandom chatter.'] },
      dc: { name: 'DC Fan Nexus', summary: 'DC films, comics, characters, and fan theories in one space.', subservers:['films','comics','characters','theories'], categories:[cat('🦇 DC Nexus', [ch('general-chat'), ch('film-talk'), ch('comic-lore'), ch('character-debates')])], aiHints:['DC subtemplate: discuss DC films, comics, lore, and characters.'] },
      harrypotter: { name: 'Wizarding World', summary: 'Houses, lore, fan theories, and magical worldbuilding chats.', subservers:['houses','lore','theories','fanart'], categories:[cat('🪄 Wizarding World', [ch('general-chat'), ch('house-common-room'), ch('lore-talk'), ch('fan-theories')])], aiHints:['Harry Potter subtemplate: discuss houses, lore, theories, and wizarding fandom.'] },
      kpop: { name: 'K-pop Stage', summary: 'Comebacks, bias talk, performances, and fandom chatter.', subservers:['comebacks','bias','performances','news'], categories:[cat('🎤 K-pop Stage', [ch('general-chat'), ch('comeback-talk'), ch('bias-corner'), ch('performance-clips')])], aiHints:['K-pop subtemplate: discuss comebacks, biases, performances, and fandom chatter.'] },
      scifi: { name: 'Sci-Fi Universe', summary: 'Space operas, tech lore, theories, and franchise crossover talk.', subservers:['lore','theories','media','debates'], categories:[cat('🚀 Sci-Fi Universe', [ch('general-chat'), ch('lore-talk'), ch('fan-theories'), ch('franchise-debates')])], aiHints:['Sci-fi subtemplate: discuss lore, theories, crossovers, and media.'] },
      comics: { name: 'Comic Book Vault', summary: 'Runs, issues, character arcs, and adaptation chatter for comic readers.', subservers:['issues','runs','characters','adaptations'], categories:[cat('📚 Comic Vault', [ch('general-chat'), ch('issue-talk'), ch('character-arcs'), ch('adaptation-watch')])], aiHints:['Comics subtemplate: discuss runs, issues, character arcs, and adaptations.'] },
    },
    usabilityFlows: ['timezone-onboarding','manual-lookup','wizard-build']
  },
  support: {
    key: 'support', name: 'Support Server', summary: 'Peer support, resources, and safer moderation.', leagueFriendly: false,
    subservers: ['peer-support','resources'],
    guideBullets: ['Peer support is for conversation, resources stay clearer and calmer.','Moderation is stricter here because the server type is more sensitive.','Aggressive banter is not the default here.'],
    joinHelp: 'Use peer-support and resources lanes; keep it calm and respectful.',
    aiHints: ['Support template: respond with more care, less edge, and avoid aggressive banter.'],
    quickAnswers: { whatisthis: 'This is a support-style server, so the tone should stay safer and more respectful.' },
    categories: [ cat('❤️ Support', [ch('general-chat'), ch('peer-support'), ch('resources', true)])],
    subtemplates: {
      recovery: { name: 'Recovery Support', summary: 'Check-ins, accountability, resources, and calm support.', subservers:['check-ins','resources','accountability'], categories:[cat('❤️ Recovery Support', [ch('check-ins'), ch('peer-support'), ch('resources', true), ch('accountability')])], aiHints:['Recovery support subtemplate: keep replies calmer, supportive, and structured.'] },
      peer: { name: 'Peer Support Circle', summary: 'General check-ins, mutual support, and resources.', subservers:['peer-support','resources','check-ins'], categories:[cat('🤝 Support Circle', [ch('general-chat'), ch('peer-support'), ch('check-ins'), ch('resources', true)])], aiHints:['Peer support subtemplate: respond with care and keep tone softer.'] },
      grief: { name: 'Grief Support Space', summary: 'Gentle support, memorial sharing, and quiet resources.', subservers:['check-ins','memorial','resources'], categories:[cat('🕯 Support Space', [ch('check-ins'), ch('peer-support'), ch('memorial-space'), ch('resources', true)])], aiHints:['Grief support subtemplate: be especially careful, gentle, and non-aggressive.'] },
    },
    usabilityFlows: ['timezone-onboarding','manual-lookup','wizard-build']
  },
  event: {
    key: 'event', name: 'Event / Campaign Server', summary: 'Schedules, Q&A, live updates, and time-boxed campaigns.', leagueFriendly: false,
    subservers: ['schedule','qa','live-updates'],
    guideBullets: ['Schedules, Q&A, and live updates are the core lanes.','This template is built for coordinated events, launches, and campaigns.','Competition flow only matters if staff explicitly attaches one.'],
    joinHelp: 'Use schedule, Q&A, and live-updates channels to follow the event.',
    aiHints: ['Event template: emphasize schedules, Q&A, live updates, and campaign flow.'],
    quickAnswers: { whatisthis: 'This server is running as an event/campaign hub: schedule, Q&A, and live updates first.' },
    categories: [ cat('🎉 Event HQ', [ch('general-chat'), ch('schedule', true), ch('qa'), ch('live-updates', true)])],
    subtemplates: {
      conference: { name: 'Conference Run', summary: 'Agenda, stages, Q&A, networking, and live updates.', subservers:['agenda','stages','qa','networking'], categories:[cat('🎤 Conference HQ', [ch('agenda', true), ch('stage-chat'), ch('qa'), ch('networking')])], aiHints:['Conference subtemplate: focus on agenda, sessions, networking, and live updates.'] },
      launch: { name: 'Launch Campaign', summary: 'Announcements, roadmap, community hype, and FAQ.', subservers:['announcements','roadmap','faq','live-updates'], categories:[cat('🚀 Launch HQ', [ch('announcements', true), ch('roadmap', true), ch('qa'), ch('live-updates', true)])], aiHints:['Launch subtemplate: focus on rollout updates, Q&A, announcements, and roadmap.'] },
      tournament: { name: 'Tournament Ops', summary: 'Brackets, schedules, results, and live operations.', subservers:['brackets','schedule','results','ops'], categories:[cat('🏆 Tournament Ops', [ch('bracket-board', true), ch('schedule', true), ch('results'), ch('ops-chat')])], aiHints:['Tournament subtemplate: focus on brackets, schedules, results, and operations.'] },
    },
    usabilityFlows: ['timezone-onboarding','event-scheduling','manual-lookup','wizard-build']
  },
};

function getTemplate(key = '') {
  const raw = String(key || '').trim().toLowerCase();
  return raw ? (TEMPLATE_REGISTRY[raw] || null) : null;
}

function getTemplateSubtemplateOptions(templateKey = '') {
  const template = getTemplate(templateKey);
  if (!template) return [];
  const entries = Object.entries(template.subtemplates || {});
  return entries.map(([value, item]) => ({
    label: item.name,
    value,
    description: String(item.summary || item.name || value).slice(0, 100),
  })).slice(0, 25);
}

function resolveTemplateProfile(settings = {}) {
  const template = getTemplate(settings.serverTemplate);
  if (!template) return null;
  const subKey = String(settings.serverSubtemplate || '').trim().toLowerCase();
  const sub = subKey && template.subtemplates && template.subtemplates[subKey] ? template.subtemplates[subKey] : null;
  if (!sub) return clone(template);
  const merged = clone(template);
  merged.baseName = template.name;
  merged.subtemplateKey = subKey;
  merged.subtemplateName = sub.name;
  merged.name = `${template.name} • ${sub.name}`;
  merged.summary = sub.summary || merged.summary;
  merged.subservers = Array.isArray(sub.subservers) && sub.subservers.length ? sub.subservers : merged.subservers;
  // V197 FIX: Normalize category names before dedup comparison.
  // Strip leading emoji/non-word chars + lowercase so "💬 Community" === "💬 Community" even with
  // variation in emoji encoding, zero-width spaces, or extra whitespace.
  const _normCatName = n => String(n || '').toLowerCase().replace(/^[^\w]+/, '').trim();
  merged.categories = (sub.categories && sub.categories.length)
    ? [
        merged.categories[0],
        ...sub.categories,
        ...merged.categories.slice(1).filter(c => {
          const baseNorm = _normCatName(c.name);
          return !sub.categories.some(sc => _normCatName(sc.name) === baseNorm);
        }),
      ]
    : merged.categories;
  merged.aiHints = [...(merged.aiHints || []), ...(sub.aiHints || [])];
  return merged;
}

function getServerTemplatesMap() {
  const out = {};
  for (const t of Object.values(TEMPLATE_REGISTRY)) out[t.key] = { name: t.name, categories: t.categories };
  return out;
}

function getTemplateOptions() {
  return Object.values(TEMPLATE_REGISTRY).map(t => ({ label: t.name, value: t.key, description: t.summary.slice(0, 100) })).slice(0, 25);
}

// Community expansion integration
// Wizard uses these to show community family + niche selectors
const communityPackService = require('./communityPackService');

module.exports = { TEMPLATE_REGISTRY, getTemplate, getTemplateOptions, getServerTemplatesMap, getTemplateSubtemplateOptions, resolveTemplateProfile };
