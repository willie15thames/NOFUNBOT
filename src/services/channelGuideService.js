/*
 * NAVIGATION HEADER
 * FILE: src/services/channelGuideService.js
 * LAYER: Service layer
 * PURPOSE: Maps every known channel name to a guide prompt that explains what the channel is for.
 *          Used by postBaseGuideMessages and postAllChannelGuides to ensure every channel has a visible explanation.
 * LOOK HERE FIRST WHEN DEBUGGING: Search for CHANNEL_GUIDES and getGuideForChannel.
 * RELATED FLOW: baseInitService.postBaseGuideMessages, createTemplateStructure, applyEditChanges.
 * NOTE: V187 — covers all 239 unique channel names across all 10 base templates + subtemplates.
 */

'use strict';
// V203: user-facing command paths come from the alias spec (grouped commands show their real path).
const { displayPath: _cmdPath } = require('./commandAliasService');

/**
 * Master channel guide map.
 * Key = lowercase channel name (without emoji prefix).
 * Value = { title, description, color (hex int) }
 *
 * Colors:
 *   0x2ecc71 = green  (welcome/join/info)
 *   0x3498db = blue   (community/discussion)
 *   0x9b59b6 = purple (creative/showcase)
 *   0xf39c12 = amber  (competitive/sports)
 *   0xe74c3c = red    (discipline/moderation)
 *   0x1abc9c = teal   (educational/resources)
 *   0xf1c40f = gold   (events/scheduling)
 *   0x5865f2 = blurple (guide/info)
 *   0x95a5a6 = gray   (staff/ops)
 */
const CHANNEL_GUIDES = {
  // ── Welcome / Info (base — every template) ──────────────────────
  'welcome':              { title: '👋 Welcome', description: 'This is the landing page for all new members. Read the pinned info, then explore the server.', color: 0x2ecc71 },
  'rules':                { title: '📖 Server Rules', description: 'All server rules and conduct expectations live here. Breaking rules leads to warnings or removal.', color: 0x4da3ff },
  'server-guide':         { title: '🧭 Server Guide', description: 'Start here to understand how this server works — what each area is for and how to participate.', color: 0x5865f2 },
  'how-to-join':          { title: '✅ How to Join', description: 'Step-by-step instructions for joining the server, claiming your spot, and getting access to the right channels.', color: 0x2ecc71 },
  'announcements':        { title: '📢 Announcements', description: 'Official announcements from staff. Read-only — check here for updates, events, and important news.', color: 0x5865f2 },
  'announcement-board':   { title: '📢 Announcement Board', description: 'Official announcements and updates from staff. Read-only.', color: 0x5865f2 },

  // ── Community / Social ──────────────────────────────────────────
  'general-chat':         { title: '💬 General Chat', description: 'The main hangout. Talk about anything server-related here. Keep it respectful.', color: 0x3498db },
  'polls':                { title: '📊 Polls & Voting', description: 'Vote-only channel. Use the posted picklists to cast your vote — no free-form chat here.', color: 0xf1c40f },
  'introductions':        { title: '👤 Introductions', description: 'Introduce yourself to the community. Name, interests, what brought you here.', color: 0x3498db },
  'media-share':          { title: '🖼 Media Share', description: 'Share images, videos, links, and other media with the community.', color: 0x3498db },
  'off-topic':            { title: '🗨 Off-Topic', description: 'Anything that doesn\'t fit elsewhere goes here. Keep it civil.', color: 0x3498db },
  'memes-and-clips':      { title: '😂 Memes & Clips', description: 'Drop your memes, funny clips, and reaction images here.', color: 0x3498db },

  // ── Gaming ──────────────────────────────────────────────────────
  'game-chat':            { title: '🎮 Game Chat', description: 'General gaming discussion. What are you playing, what\'s good, what\'s trash.', color: 0xf39c12 },
  'squad-up':             { title: '🎯 Squad Up', description: 'Find people to play with. Post your game, platform, and when you\'re on.', color: 0xf39c12 },
  'match-hub':            { title: '🏟 Match Hub', description: 'Coordinate matches, post results, and track competitive play here.', color: 0xf39c12 },
  'voice-room-info':      { title: '🔊 Voice Room Info', description: 'Info about voice channels, rules, and availability. Read-only.', color: 0x5865f2 },
  'clips-and-highlights': { title: '🎬 Clips & Highlights', description: 'Post your best plays, clutch moments, and highlight reels.', color: 0x9b59b6 },
  'looking-for-group':    { title: '🔍 Looking for Group', description: 'Need a squad, a team, or a partner? Post here with your game and times.', color: 0xf39c12 },
  'what-are-we-playing':  { title: '🎲 What Are We Playing?', description: 'Discuss the current rotation. Vote on what the group plays next.', color: 0xf39c12 },
  'game-recommendations': { title: '💡 Game Recommendations', description: 'Suggest games, rate them, and find your next play.', color: 0xf39c12 },
  'game-night':           { title: '🌙 Game Night', description: 'Coordinate game night events, times, and invites.', color: 0xf1c40f },
  'co-op-planning':       { title: '🤝 Co-op Planning', description: 'Plan co-op sessions, match schedules, and team activities.', color: 0xf1c40f },

  // ── COD ─────────────────────────────────────────────────────────
  'party-up':             { title: '🎯 Party Up', description: 'Find a squad for your next session. Drop your tag and platform.', color: 0xf39c12 },
  'loadouts-and-metas':   { title: '🔫 Loadouts & Metas', description: 'Share loadouts, discuss the current meta, and theory-craft builds.', color: 0xf39c12 },
  'warzone-lfg':          { title: '🪂 Warzone LFG', description: 'Find Warzone squads here. Drop your rank and playstyle.', color: 0xf39c12 },
  'ranked-grind':         { title: '🏅 Ranked Grind', description: 'Ranked discussion, climb updates, and competitive improvement talk.', color: 0xf39c12 },
  'scrim-planning':       { title: '📋 Scrim Planning', description: 'Organize scrimmages, set times, and coordinate team practice.', color: 0xf39c12 },
  'patch-watch':          { title: '📡 Patch Watch', description: 'Latest patch notes, updates, and balance changes. Read-only.', color: 0x5865f2 },
  'legend-talk':          { title: '🎮 Legend Talk', description: 'Discuss legends, characters, abilities, and tier picks.', color: 0x3498db },
  'clip-review':          { title: '🎬 Clip Review', description: 'Post gameplay clips for feedback, analysis, and improvement tips.', color: 0x9b59b6 },
  'map-rotations':        { title: '🗺 Map Rotations', description: 'Current map rotation, landing spots, and rotation strategies.', color: 0xf39c12 },

  // ── GTA ─────────────────────────────────────────────────────────
  'crew-recruiting':      { title: '🤝 Crew Recruiting', description: 'Looking for crew members or looking to join? Post here.', color: 0xf39c12 },
  'heist-board':          { title: '💰 Heist Board', description: 'Organize heists, find players, and plan your approach.', color: 0xf39c12 },
  'clips-and-chaos':      { title: '🎥 Clips & Chaos', description: 'Drop your wildest clips, stunts, and GTA moments.', color: 0x9b59b6 },
  'rp-talk':              { title: '🎭 RP Talk', description: 'Roleplay discussion, character planning, and RP server coordination.', color: 0x3498db },
  'races-and-meets':      { title: '🏎 Races & Meets', description: 'Organize races, car meets, and driving events.', color: 0xf39c12 },
  'money-runs':           { title: '💵 Money Runs', description: 'Grind strategies, money methods, and efficient farming routes.', color: 0xf39c12 },
  'server-updates':       { title: '📋 Server Updates', description: 'Official server updates and announcements. Read-only.', color: 0x5865f2 },

  // ── Minecraft ───────────────────────────────────────────────────
  'realm-chat':           { title: '⛏ Realm Chat', description: 'Discussion about the active realm — rules, events, and coordination.', color: 0xf39c12 },
  'build-showcase':       { title: '🏗 Build Showcase', description: 'Show off your builds. Screenshots, coords, and build tours welcome.', color: 0x9b59b6 },
  'mod-pack-talk':        { title: '🔧 Mod Pack Talk', description: 'Discuss mods, datapacks, and modded server setups.', color: 0x3498db },
  'seed-and-spawn':       { title: '🌱 Seed & Spawn', description: 'Share seeds, spawn coords, and world-gen discoveries.', color: 0x1abc9c },
  'resource-runs':        { title: '⛏ Resource Runs', description: 'Coordinate mining trips, farm builds, and resource gathering.', color: 0xf39c12 },
  'events-and-raids':     { title: '🏰 Events & Raids', description: 'Community events, raid nights, and special challenges.', color: 0xf1c40f },
  'server-status':        { title: '🟢 Server Status', description: 'Current server status, uptime, and maintenance info. Read-only.', color: 0x5865f2 },

  // ── Roblox ──────────────────────────────────────────────────────
  'experience-talk':      { title: '🎮 Experience Talk', description: 'Discuss Roblox experiences, favorites, and new releases.', color: 0xf39c12 },
  'studio-help':          { title: '🔧 Studio Help', description: 'Roblox Studio questions, scripting help, and development talk.', color: 0x1abc9c },
  'creator-showcase':     { title: '🎨 Creator Showcase', description: 'Show off your Roblox creations, games, and builds.', color: 0x9b59b6 },
  'group-updates':        { title: '📢 Group Updates', description: 'Official group updates and announcements. Read-only.', color: 0x5865f2 },

  // ── MMO ─────────────────────────────────────────────────────────
  'guild-recruitment':    { title: '🛡 Guild Recruitment', description: 'Recruit for your guild or find one to join. Post your class and role.', color: 0xf39c12 },
  'class-talk':           { title: '⚔ Class Talk', description: 'Discuss builds, specs, rotations, and class-specific strategies.', color: 0x3498db },
  'loot-discussion':      { title: '💎 Loot Discussion', description: 'Drops, rolls, gear goals, and loot systems.', color: 0xf39c12 },
  'raid-signups':         { title: '🐉 Raid Signups', description: 'Sign up for upcoming raids. Post your role and availability.', color: 0xf1c40f },
  'boss-strats':          { title: '📖 Boss Strats', description: 'Boss fight strategies, guides, and phase breakdowns.', color: 0x1abc9c },
  'event-calendar':       { title: '📅 Event Calendar', description: 'Upcoming events, schedules, and important dates. Read-only.', color: 0xf1c40f },
  'event-updates':        { title: '📢 Event Updates', description: 'Latest event news, changes, and announcements. Read-only.', color: 0xf1c40f },

  // ── Fighting Game ───────────────────────────────────────────────
  'set-finder':           { title: '🥊 Set Finder', description: 'Find matches. Post your character, rank, and platform.', color: 0xf39c12 },
  'matchup-talk':         { title: '🎯 Matchup Talk', description: 'Character matchup discussion, frame data, and strategy.', color: 0x3498db },
  'tech-and-combos':      { title: '🔥 Tech & Combos', description: 'Share combos, tech discoveries, and execution tips.', color: 0x9b59b6 },
  'tournament-signups':   { title: '🏆 Tournament Signups', description: 'Register for upcoming tournaments. Read bracket info here.', color: 0xf1c40f },
  'vod-review':           { title: '🎬 VOD Review', description: 'Post gameplay footage for feedback and improvement.', color: 0x9b59b6 },
  'tier-list-talk':       { title: '📊 Tier List Talk', description: 'Discuss character tiers, rankings, and meta shifts.', color: 0x3498db },

  // ── Racing ──────────────────────────────────────────────────────
  'lobby-finder':         { title: '🏎 Lobby Finder', description: 'Find racing lobbies. Post your game, class, and availability.', color: 0xf39c12 },
  'tuning-talk':          { title: '🔧 Tuning Talk', description: 'Share tunes, setups, and car builds.', color: 0x3498db },
  'race-calendar':        { title: '📅 Race Calendar', description: 'Upcoming races, series schedules, and event dates. Read-only.', color: 0xf1c40f },
  'results-board':        { title: '🏁 Results Board', description: 'Race results, standings updates, and podium finishes. Read-only.', color: 0x5865f2 },
  'car-showcase':         { title: '🚗 Car Showcase', description: 'Show off your builds, liveries, and garage.', color: 0x9b59b6 },
  'crew-updates':         { title: '📢 Crew Updates', description: 'Official crew announcements and updates.', color: 0x5865f2 },

  // ── Mobile ──────────────────────────────────────────────────────
  'meta-talk':            { title: '📊 Meta Talk', description: 'Discuss the current meta, tier lists, and optimal strategies.', color: 0x3498db },
  'event-chat':           { title: '🎉 Event Chat', description: 'Discuss ongoing in-game events, rewards, and strategies.', color: 0xf1c40f },
  'clan-recruiting':      { title: '🏰 Clan Recruiting', description: 'Recruit for your clan or find one to join.', color: 0xf39c12 },
  'help-and-guides':      { title: '📖 Help & Guides', description: 'Ask for help, share guides, and find answers to common questions.', color: 0x1abc9c },

  // ── Esports ─────────────────────────────────────────────────────
  'roster-room':          { title: '📋 Roster Room', description: 'Team roster management, player roles, and lineup decisions.', color: 0xf39c12 },
  'match-prep':           { title: '📝 Match Prep', description: 'Pre-match preparation, scouting, and strategy planning.', color: 0xf39c12 },
  'bracket-watch':        { title: '🏆 Bracket Watch', description: 'Follow tournament brackets, seeds, and advancement.', color: 0xf1c40f },

  // ── Sports Central ──────────────────────────────────────────────
  'game-day':             { title: '🏟 Game Day', description: 'Live game day discussion. React, celebrate, and trash-talk in real time.', color: 0xf39c12 },
  'scores-and-standings': { title: '📊 Scores & Standings', description: 'Current scores, standings, and stat updates. Read-only.', color: 0x5865f2 },
  'team-talk':            { title: '🏈 Team Talk', description: 'Discuss your team — trades, roster moves, strategies, and hot takes.', color: 0x3498db },
  'schedule-board':       { title: '📅 Schedule Board', description: 'Current schedule, upcoming matchups, and key dates. Read-only.', color: 0xf1c40f },
  'watch-party-planning': { title: '📺 Watch Party Planning', description: 'Coordinate watch parties — times, links, and who\'s in.', color: 0xf1c40f },
  'fantasy-talk':         { title: '🏆 Fantasy Talk', description: 'Fantasy discussion — lineups, waivers, trades, and bragging rights.', color: 0xf39c12 },
  'match-lobby':          { title: '🎮 Match Lobby', description: 'Coordinate matches and game sessions here.', color: 0xf39c12 },
  'power-rankings':       { title: '📈 Power Rankings', description: 'Discuss power rankings, hot streaks, and who\'s rising or falling.', color: 0xf39c12 },

  // ── NFL / NBA / Soccer / MLB / College / Fantasy / Betting / Fan / Watch ──
  'gameday-redzone':      { title: '🔴 Gameday Redzone', description: 'Live redzone reactions and scoring updates.', color: 0xf39c12 },
  'nfl-scores':           { title: '📊 NFL Scores', description: 'NFL scores and stat lines. Read-only.', color: 0x5865f2 },
  'hoops-night':          { title: '🏀 Hoops Night', description: 'Live NBA game night discussion and reactions.', color: 0xf39c12 },
  'player-debates':       { title: '🗣 Player Debates', description: 'Argue about who\'s better, who\'s overrated, and who deserves the crown.', color: 0x3498db },
  'highlight-tape':       { title: '🎬 Highlight Tape', description: 'Post and watch the best plays, dunks, and highlight reels.', color: 0x9b59b6 },
  'fantasy-hoops':        { title: '🏀 Fantasy Hoops', description: 'Fantasy basketball — lineups, waiver pickups, and trade talk.', color: 0xf39c12 },
  'trade-talk':           { title: '🤝 Trade Talk', description: 'Discuss trades — proposed, completed, and rumored.', color: 0xf39c12 },
  'fixtures-board':       { title: '📅 Fixtures Board', description: 'Upcoming fixtures and match schedules. Read-only.', color: 0xf1c40f },
  'matchday-chat':        { title: '⚽ Matchday Chat', description: 'Live matchday discussion and reactions.', color: 0xf39c12 },
  'supporter-sections':   { title: '📣 Supporter Sections', description: 'Find your club\'s supporters and join the chants.', color: 0x3498db },
  'transfer-talk':        { title: '💰 Transfer Talk', description: 'Transfer rumors, confirmed deals, and window chatter.', color: 0xf39c12 },
  'goal-clips':           { title: '⚽ Goal Clips', description: 'Post and watch the best goals, saves, and skill moves.', color: 0x9b59b6 },
  'game-thread':          { title: '🗣 Game Thread', description: 'Live game discussion thread. React in real time.', color: 0xf39c12 },
  'mlb-scores':           { title: '⚾ MLB Scores', description: 'MLB scores and box scores. Read-only.', color: 0x5865f2 },
  'fantasy-baseball':     { title: '⚾ Fantasy Baseball', description: 'Fantasy baseball — rosters, waivers, and matchups.', color: 0xf39c12 },
  'trade-block':          { title: '📋 Trade Block', description: 'Post players available for trade and browse offers.', color: 0xf39c12 },
  'rankings-watch':       { title: '📊 Rankings Watch', description: 'Follow rankings, poll movements, and playoff projections.', color: 0xf39c12 },
  'rivalry-row':          { title: '🔥 Rivalry Row', description: 'Rivalry trash talk and heated debates. Keep it competitive, not personal.', color: 0xf39c12 },
  'gameday-chat':         { title: '📺 Gameday Chat', description: 'Live game day discussion for all matchups.', color: 0xf39c12 },
  'commitment-talk':      { title: '🎓 Commitment Talk', description: 'Recruiting commitments, decommitments, and signing day buzz.', color: 0x3498db },
  'upset-alerts':         { title: '🚨 Upset Alerts', description: 'Breaking upsets, buzzer beaters, and shocking results.', color: 0xf39c12 },
  'draft-prep':           { title: '📋 Draft Prep', description: 'Draft strategy, rankings, and mock draft discussion.', color: 0xf39c12 },
  'lineup-advice':        { title: '📝 Lineup Advice', description: 'Get and give lineup advice. Start/sit, flex plays, and matchup analysis.', color: 0x3498db },
  'waiver-wire':          { title: '🔄 Waiver Wire', description: 'Waiver wire targets, pickups, and drop candidates.', color: 0xf39c12 },
  'buy-low-sell-high':    { title: '📈 Buy Low / Sell High', description: 'Identify undervalued assets and sell-high candidates.', color: 0xf39c12 },
  'injury-watch':         { title: '🏥 Injury Watch', description: 'Injury reports, return timelines, and impact analysis. Read-only.', color: 0x5865f2 },
  'pick-talk':            { title: '🎲 Pick Talk', description: 'Share and discuss picks, predictions, and analysis.', color: 0xf39c12 },
  'odds-and-lines':       { title: '📊 Odds & Lines', description: 'Discuss opening lines, movement, and value spots.', color: 0xf39c12 },
  'live-sweats':          { title: '😰 Live Sweats', description: 'Live bet tracking and real-time reactions.', color: 0xf39c12 },
  'bankroll-talk':        { title: '💰 Bankroll Talk', description: 'Bankroll management, staking plans, and discipline discussion.', color: 0x3498db },
  'parlay-corner':        { title: '🎰 Parlay Corner', description: 'Parlay builds, hits, and heartbreakers.', color: 0xf39c12 },
  'fan-memes':            { title: '😂 Fan Memes', description: 'Team memes, rivalry jokes, and fan humor.', color: 0x3498db },
  'rivalry-talk':         { title: '🔥 Rivalry Talk', description: 'Rivalry banter and heated fan debates.', color: 0xf39c12 },
  'live-reactions':       { title: '📺 Live Reactions', description: 'React in real time during broadcasts and live events.', color: 0xf39c12 },
  'broadcast-schedule':   { title: '📅 Broadcast Schedule', description: 'Upcoming broadcasts, streams, and viewing times. Read-only.', color: 0xf1c40f },
  'postgame-recap':       { title: '📝 Postgame Recap', description: 'Post-game analysis, reactions, and takeaways.', color: 0x3498db },
  'clip-dump':            { title: '🎬 Clip Dump', description: 'Drop clips, highlights, and replay-worthy moments.', color: 0x9b59b6 },
  'prediction-board':     { title: '🔮 Prediction Board', description: 'Make your predictions before games start. Brag later.', color: 0xf1c40f },
  'trade-machine':        { title: '⚙ Trade Machine', description: 'Build hypothetical trades and get community feedback.', color: 0xf39c12 },

  // ── Educational ─────────────────────────────────────────────────
  'resources':            { title: '📚 Resources', description: 'Curated learning resources, links, and reference materials. Read-only.', color: 0x1abc9c },
  'questions':            { title: '❓ Questions', description: 'Ask questions and get answers from the community and staff.', color: 0x1abc9c },
  'study-hall':           { title: '📖 Study Hall', description: 'Focused study discussion. Keep it on-topic and productive.', color: 0x1abc9c },
  'projects':             { title: '🛠 Projects', description: 'Share project work, get feedback, and collaborate.', color: 0x1abc9c },
  'office-hours':         { title: '🕐 Office Hours', description: 'Staff availability windows for 1:1 help and questions. Read-only.', color: 0x1abc9c },
  'assignments':          { title: '📝 Assignments', description: 'Assignment details, deadlines, and submission info. Read-only.', color: 0x1abc9c },
  'lab-help':             { title: '🧪 Lab Help', description: 'Get help with labs, exercises, and hands-on work.', color: 0x1abc9c },
  'project-showcase':     { title: '🎨 Project Showcase', description: 'Show off completed projects and get recognition.', color: 0x9b59b6 },
  'study-groups':         { title: '👥 Study Groups', description: 'Form study groups, set schedules, and coordinate sessions.', color: 0x1abc9c },
  'debugging-help':       { title: '🐛 Debugging Help', description: 'Post bugs, errors, and broken code for community help.', color: 0x1abc9c },
  'resource-drop':        { title: '📦 Resource Drop', description: 'Share useful resources, tools, and links. Read-only.', color: 0x1abc9c },
  'practice-chat':        { title: '🗣 Practice Chat', description: 'Practice conversation, exercises, and language exchange.', color: 0x1abc9c },
  'culture-exchange':     { title: '🌍 Culture Exchange', description: 'Share cultural insights, traditions, and perspectives.', color: 0x3498db },
  'accountability-check-in': { title: '✅ Accountability Check-In', description: 'Daily/weekly check-ins to stay on track with goals.', color: 0x1abc9c },
  'practice-questions':   { title: '📝 Practice Questions', description: 'Practice problems, quizzes, and test prep exercises.', color: 0x1abc9c },
  'strategy-talk':        { title: '🧠 Strategy Talk', description: 'Discuss strategies, approaches, and problem-solving methods.', color: 0x1abc9c },
  'paper-planning':       { title: '📄 Paper Planning', description: 'Outline papers, discuss thesis topics, and plan research.', color: 0x1abc9c },
  'source-board':         { title: '📖 Source Board', description: 'Share and discuss sources, citations, and reference materials. Read-only.', color: 0x1abc9c },
  'peer-review':          { title: '📝 Peer Review', description: 'Submit work for peer feedback and constructive critique.', color: 0x1abc9c },
  'reading-schedule':     { title: '📅 Reading Schedule', description: 'Current reading assignments and chapter deadlines. Read-only.', color: 0x1abc9c },
  'chapter-chat':         { title: '📖 Chapter Chat', description: 'Discuss current chapters, passages, and reading progress.', color: 0x1abc9c },
  'study-notes':          { title: '📝 Study Notes', description: 'Share notes, summaries, and study aids.', color: 0x1abc9c },
  'research-notes':       { title: '🔬 Research Notes', description: 'Share findings, data, and research progress.', color: 0x1abc9c },
  'cert-talk':            { title: '📜 Cert Talk', description: 'Certification paths, study plans, and exam experiences.', color: 0x1abc9c },
  'threat-intel':         { title: '🛡 Threat Intel', description: 'Threat intelligence sharing, indicators, and analysis.', color: 0x1abc9c },
  'code-help':            { title: '💻 Code Help', description: 'Get help with code questions, debugging, and implementation.', color: 0x1abc9c },

  // ── Movie / Watch Party ─────────────────────────────────────────
  'release-calendar':     { title: '📅 Release Calendar', description: 'Upcoming releases, premiere dates, and drop schedules. Read-only.', color: 0xf1c40f },
  'reviews':              { title: '⭐ Reviews', description: 'Share your reviews, ratings, and takes on what you\'ve watched.', color: 0x9b59b6 },
  'recommendations':      { title: '💡 Recommendations', description: 'Ask for or give recommendations. Help the community find their next watch.', color: 0x3498db },
  'spoilers':             { title: '⚠ Spoilers', description: 'SPOILERS ALLOWED HERE. If you haven\'t watched, stay out. You\'ve been warned.', color: 0xe74c3c },
  'theories':             { title: '🔮 Theories', description: 'Share theories, predictions, and speculation about upcoming content.', color: 0x9b59b6 },
  'scene-breakdown':      { title: '🎬 Scene Breakdown', description: 'Deep-dive analysis of specific scenes, shots, and moments.', color: 0x9b59b6 },
  'cast-talk':            { title: '🎭 Cast Talk', description: 'Discuss actors, performances, casting news, and behind-the-scenes.', color: 0x3498db },
  'director-talk':        { title: '🎬 Director Talk', description: 'Discuss directors, filmmaking styles, and creative vision.', color: 0x9b59b6 },
  'episode-talk':         { title: '📺 Episode Talk', description: 'Discuss the latest episodes, reactions, and key moments.', color: 0x3498db },
  'character-rankings':   { title: '📊 Character Rankings', description: 'Rank characters, debate power levels, and argue who\'s best.', color: 0x3498db },
  'opening-and-ending-hall': { title: '🎵 Opening & Ending Hall', description: 'Celebrate the best openings, endings, and theme songs.', color: 0x9b59b6 },
  'show-night':           { title: '📺 Show Night', description: 'Live reactions and discussion during show broadcasts.', color: 0xf39c12 },
  'promo-classics':       { title: '🎤 Promo Classics', description: 'The best promos, speeches, and iconic moments.', color: 0x9b59b6 },
  'match-cards':          { title: '📋 Match Cards', description: 'Discuss upcoming match cards, predictions, and dream matches.', color: 0xf39c12 },

  // ── Community Subtemplates ──────────────────────────────────────
  'daily-chat':           { title: '💬 Daily Chat', description: 'Daily conversation, updates, and what\'s happening.', color: 0x3498db },
  'plans-and-links':      { title: '📌 Plans & Links', description: 'Share plans, event links, and coordination posts.', color: 0x3498db },
  'media-dump':           { title: '🖼 Media Dump', description: 'Drop images, videos, and links freely.', color: 0x3498db },
  'memes-only':           { title: '😂 Memes Only', description: 'Memes only. No discussion. Just memes.', color: 0x3498db },
  'reaction-dump':        { title: '😆 Reaction Dump', description: 'Reaction images, GIFs, and meme reactions.', color: 0x3498db },
  'clip-spam':            { title: '🎬 Clip Spam', description: 'Drop clips freely. No moderation on volume.', color: 0x3498db },
  'night-owls':           { title: '🌙 Night Owls', description: 'Late-night chat for the night crew.', color: 0x3498db },
  'music-share':          { title: '🎵 Music Share', description: 'Share what you\'re listening to — songs, albums, playlists.', color: 0x9b59b6 },
  'vc-plans':             { title: '🔊 VC Plans', description: 'Coordinate voice chat sessions and call times.', color: 0xf1c40f },
  'hot-takes':            { title: '🔥 Hot Takes', description: 'Drop your hottest takes. Be bold. Be wrong. Be entertaining.', color: 0xf39c12 },
  'debate-stage':         { title: '🗣 Debate Stage', description: 'Structured debates and arguments. Pick a side and defend it.', color: 0x3498db },
  'local-events':         { title: '📍 Local Events', description: 'Nearby events, meetups, and happenings.', color: 0xf1c40f },
  'food-spots':           { title: '🍔 Food Spots', description: 'Recommend restaurants, food trucks, and hidden gems.', color: 0x3498db },
  'community-alerts':     { title: '🚨 Community Alerts', description: 'Important local alerts and community updates.', color: 0xe74c3c },
  'topic-of-the-day':     { title: '💬 Topic of the Day', description: 'Today\'s discussion topic. Jump in and share your thoughts.', color: 0x3498db },
  'share-corner':         { title: '📤 Share Corner', description: 'Share anything interesting — links, finds, discoveries.', color: 0x3498db },

  // ── Creative ────────────────────────────────────────────────────
  'showcase':             { title: '🎨 Showcase', description: 'Post your finished work for the community to see and appreciate.', color: 0x9b59b6 },
  'feedback':             { title: '📝 Feedback', description: 'Request and give constructive feedback on work in progress.', color: 0x9b59b6 },
  'collabs':              { title: '🤝 Collabs', description: 'Find collaborators, pitch ideas, and team up on projects.', color: 0x9b59b6 },
  'wip-feedback':         { title: '🔨 WIP Feedback', description: 'Share works-in-progress for early feedback and direction.', color: 0x9b59b6 },
  'references':           { title: '📖 References', description: 'Share reference images, inspiration, and study materials. Read-only.', color: 0x1abc9c },
  'commission-corner':    { title: '💰 Commission Corner', description: 'Post commission info, availability, and pricing.', color: 0x9b59b6 },
  'production-talk':      { title: '🎛 Production Talk', description: 'Discuss production techniques, tools, and workflows.', color: 0x9b59b6 },
  'prompt-lab':           { title: '✍ Prompt Lab', description: 'Writing prompts, creative exercises, and spark ideas.', color: 0x9b59b6 },
  'worldbuilding':        { title: '🌍 Worldbuilding', description: 'Build worlds, lore, maps, and fictional universes.', color: 0x9b59b6 },

  // ── Professional ────────────────────────────────────────────────
  'jobs':                 { title: '💼 Jobs', description: 'Job postings, opportunities, and career openings.', color: 0x95a5a6 },
  'networking':           { title: '🤝 Networking', description: 'Connect with others, share your background, and build relationships.', color: 0x95a5a6 },
  'job-postings':         { title: '📌 Job Postings', description: 'Open positions and hiring announcements. Read-only.', color: 0x95a5a6 },
  'referral-requests':    { title: '🔗 Referral Requests', description: 'Request or offer referrals for open positions.', color: 0x95a5a6 },
  'interview-prep':       { title: '📝 Interview Prep', description: 'Prepare for interviews — practice questions, tips, and mock runs.', color: 0x1abc9c },
  'resume-review':        { title: '📄 Resume Review', description: 'Get feedback on your resume from the community.', color: 0x95a5a6 },
  'founder-chat':         { title: '🚀 Founder Chat', description: 'Founder-to-founder discussion, challenges, and wins.', color: 0x95a5a6 },
  'launch-updates':       { title: '🚀 Launch Updates', description: 'Product launch updates, milestones, and announcements.', color: 0x95a5a6 },
  'operator-room':        { title: '⚙ Operator Room', description: 'Operations discussion — processes, tools, and execution.', color: 0x95a5a6 },
  'deal-flow':            { title: '💰 Deal Flow', description: 'Discuss deals, partnerships, and business opportunities.', color: 0x95a5a6 },
  'project-talk':         { title: '🛠 Project Talk', description: 'Discuss ongoing projects, blockers, and progress.', color: 0x95a5a6 },
  'tooling-chat':         { title: '🔧 Tooling Chat', description: 'Discuss tools, software, and workflow optimization.', color: 0x95a5a6 },
  'design-showcase':      { title: '🎨 Design Showcase', description: 'Share design work for feedback and recognition.', color: 0x9b59b6 },
  'feedback-corner':      { title: '📝 Feedback Corner', description: 'Give and receive feedback on work and ideas.', color: 0x9b59b6 },
  'client-talk':          { title: '🧾 Client Talk', description: 'Discuss client management, communication, and project scoping.', color: 0x95a5a6 },
  'pricing-help':         { title: '💵 Pricing Help', description: 'Get advice on pricing, rates, and value positioning.', color: 0x95a5a6 },
  'portfolio-room':       { title: '🎯 Portfolio Room', description: 'Share your portfolio and get improvement suggestions.', color: 0x9b59b6 },
  'budget-talk':          { title: '💰 Budget Talk', description: 'Budgeting strategies, tools, and accountability.', color: 0x95a5a6 },
  'planning-room':        { title: '📋 Planning Room', description: 'Financial planning, goal setting, and long-term strategy.', color: 0x95a5a6 },

  // ── Fandom ──────────────────────────────────────────────────────
  'fan-art':              { title: '🎨 Fan Art', description: 'Share your fan art, edits, and creative tributes.', color: 0x9b59b6 },
  'fan-theories':         { title: '🔮 Fan Theories', description: 'Share theories, evidence, and speculation.', color: 0x9b59b6 },
  'lore-talk':            { title: '📖 Lore Talk', description: 'Deep-dive into lore, worldbuilding, and canon details.', color: 0x9b59b6 },
  'canon-and-legends':    { title: '📚 Canon & Legends', description: 'Discuss official canon vs legends/non-canon material.', color: 0x9b59b6 },
  'mcu-talk':             { title: '🦸 MCU Talk', description: 'Discuss MCU films, shows, and connected universe events.', color: 0x3498db },
  'film-talk':            { title: '🎬 Film Talk', description: 'Discuss films, series, and visual storytelling.', color: 0x3498db },
  'parks-and-trips':      { title: '🏰 Parks & Trips', description: 'Theme park visits, trip reports, and planning tips.', color: 0xf1c40f },
  'comic-lore':           { title: '📚 Comic Lore', description: 'Discuss comic storylines, arcs, and lore deep-dives.', color: 0x9b59b6 },
  'character-debates':    { title: '🗣 Character Debates', description: 'Debate characters, power levels, and who\'d win in a fight.', color: 0x3498db },
  'character-arcs':       { title: '📖 Character Arcs', description: 'Discuss character development, growth, and story arcs.', color: 0x9b59b6 },
  'house-common-room':    { title: '🏠 House Common Room', description: 'Hang out with your house. Represent your colors.', color: 0x3498db },
  'comeback-talk':        { title: '🎤 Comeback Talk', description: 'Discuss new releases, comebacks, and drop announcements.', color: 0x3498db },
  'bias-corner':          { title: '💜 Bias Corner', description: 'Celebrate your bias. Edits, photos, and appreciation posts.', color: 0x9b59b6 },
  'performance-clips':    { title: '🎬 Performance Clips', description: 'Share performance videos, fancams, and stage moments.', color: 0x9b59b6 },
  'franchise-debates':    { title: '🗣 Franchise Debates', description: 'Cross-franchise arguments and versus discussions.', color: 0x3498db },
  'issue-talk':           { title: '📖 Issue Talk', description: 'Discuss specific comic issues, chapters, and releases.', color: 0x9b59b6 },
  'adaptation-watch':     { title: '📺 Adaptation Watch', description: 'Track and discuss adaptations from source material.', color: 0x3498db },

  // ── Support ─────────────────────────────────────────────────────
  'peer-support':         { title: '❤ Peer Support', description: 'A safe space for mutual support. Be kind, listen, and lift each other up.', color: 0x2ecc71 },
  'check-ins':            { title: '✅ Check-Ins', description: 'Daily or weekly check-ins. How are you doing today?', color: 0x2ecc71 },
  'accountability':       { title: '📋 Accountability', description: 'Set goals, track progress, and hold each other accountable.', color: 0x2ecc71 },
  'memorial-space':       { title: '🕯 Memorial Space', description: 'A quiet space for remembrance, reflection, and honoring loved ones.', color: 0x2ecc71 },

  // ── Event / Campaign ────────────────────────────────────────────
  'schedule':             { title: '📅 Schedule', description: 'Event schedule, timelines, and key dates. Read-only.', color: 0xf1c40f },
  'qa':                   { title: '❓ Q&A', description: 'Ask questions and get answers from staff and speakers.', color: 0x1abc9c },
  'live-updates':         { title: '📡 Live Updates', description: 'Real-time event updates and announcements. Read-only.', color: 0xf1c40f },
  'agenda':               { title: '📋 Agenda', description: 'Event agenda, sessions, and track details. Read-only.', color: 0xf1c40f },
  'stage-chat':           { title: '🎤 Stage Chat', description: 'Live discussion during sessions and presentations.', color: 0xf39c12 },
  'roadmap':              { title: '🗺 Roadmap', description: 'Product or project roadmap and future plans. Read-only.', color: 0xf1c40f },
  'bracket-board':        { title: '🏆 Bracket Board', description: 'Tournament brackets, seedings, and matchup tracking. Read-only.', color: 0xf1c40f },
  'results':              { title: '🏁 Results', description: 'Event results, outcomes, and final standings.', color: 0xf39c12 },
  'ops-chat':             { title: '⚙ Ops Chat', description: 'Behind-the-scenes operations and coordination.', color: 0x95a5a6 },

  // ── Discipline (base — every template) ──────────────────────────
  'active-check':         { title: '📋 Active Check', description: 'Activity checks and roll calls. Respond when tagged to confirm you\'re active.', color: 0xe74c3c },
  'warnings-log':         { title: '⚠ Warnings Log', description: 'Issued warnings and discipline history. Read-only.', color: 0xe74c3c },
  'boot-log':             { title: '🥾 Boot Log', description: 'Member removals, bans, and boot actions. Read-only.', color: 0xe74c3c },

  // ── Staff / Admin (V199.1) ──────────────────────────────────────
  'commissioner-ai':      { title: '🤖 Commissioner AI', description: 'Talk directly to the bot AI as commissioner. Full server awareness, diagnostic access, and admin operations.', color: 0x95a5a6 },
  'admin-hq':             { title: '🛡 Admin HQ', description: 'Admin-only bot operations, diagnostics, permissions, and server health tools.', color: 0x95a5a6 },
  'commish-hub':          { title: '📋 Commissioner Hub', description: 'Commissioner workspace — dashboards, member records, community management, bot identity, and tone configuration.', color: 0x95a5a6 },
  'scoresheets':          { title: '📊 Scoresheets', description: 'Private data intake — upload screenshots, import schedules, submit game results and stat data.', color: 0x95a5a6 },
  'setup-wizard':         { title: '🧙 Setup Wizard', description: 'Server setup and configuration. Use the wizard to build, reset, or reconfigure the server.', color: 0x5865f2 },

  // ── League — Scheduling (V199.1) ────────────────────────────────
  'weekly-schedule':      { title: '📅 Weekly Schedule', description: 'Current week matchup schedule. Updated each time the week advances.', color: 0xf1c40f },
  'open-teams':           { title: '🏟 Open Teams', description: 'Available teams, team claiming, and roster management.', color: 0xf39c12 },
  'scores-and-standings': { title: '🏆 Scores & Standings', description: 'Live scores and current standings. Updated automatically when results are submitted.', color: 0xf39c12 },
  'schedule-board':       { title: '📋 Schedule Board', description: 'Weekly matchup schedule. Read-only — updates when the week advances.', color: 0xf1c40f },
  'league-announcements': { title: '📢 League Announcements', description: 'Official league updates and commissioner broadcasts. Read-only.', color: 0x5865f2 },
  'trash-talk':           { title: '🗣 Trash Talk', description: 'Pre-game and post-game banter. Keep it fun — no slurs or real hate.', color: 0xf39c12 },

  // ── League — Teams (V199.1) ─────────────────────────────────────
  'team-chat':            { title: '💬 Team Chat', description: 'Team-specific discussion, strategy, and coordination.', color: 0xf39c12 },
  'league-chat':          { title: '🏟 League Chat', description: 'General league discussion. Talk matchups, trades, standings, and league business.', color: 0xf39c12 },

  // ── League — Trades (V199.1) ────────────────────────────────────
  'pending-trades':       { title: '🔄 Pending Trades', description: 'Trade proposals awaiting commissioner review.', color: 0xf39c12 },
  'accepted-trades':      { title: '✅ Accepted Trades', description: 'Approved trades. Read-only log.', color: 0x2ecc71 },
  'declined-trades':      { title: '❌ Declined Trades', description: 'Declined trade proposals. Read-only log.', color: 0xe74c3c },
  'transactions':         { title: '📜 Transactions', description: 'All roster moves — trades, signings, releases, and waiver claims. Read-only.', color: 0xf39c12 },

  // ── League — Rewards (V199.1) ───────────────────────────────────
  'rewards':              { title: '🏅 Rewards', description: 'Player of the Week, stream credits, yearly awards, and attribute boosts. Read-only.', color: 0xf1c40f },
  'stat-leaders':         { title: '📊 Stat Leaders', description: 'Top performers in key stat categories. Read-only.', color: 0xf39c12 },
  'player-of-the-week':   { title: '⭐ Player of the Week', description: 'Weekly standout performer. AI-nominated, commissioner-confirmed.', color: 0xf1c40f },
  'dev-upgrades':         { title: '📈 Dev Upgrades', description: 'Attribute boost awards and claims. Earned through competition, streams, or commissioner awards.', color: 0xf39c12 },
  'superbowl-history':    { title: '🏆 Championship History', description: 'All-time championship winners and records. Read-only.', color: 0xf1c40f },
  'livestreams':          { title: '📺 Livestreams', description: 'Stream tracking and credit board. Post your stream link to earn credit.', color: 0x9b59b6 },
  'game-results':         { title: '🏁 Game Results', description: 'Submit and view game scores. Results auto-post with win/loss color coding.', color: 0xf39c12 },
  'game-of-the-week':     { title: '🎯 Game of the Week', description: 'Featured matchup of the week. Read-only.', color: 0xf1c40f },

  // ── League — Live Sync (V199.1) ─────────────────────────────────
  'live-sync':            { title: '🔗 Live Sync', description: 'Live data sync status for external sources. Read-only.', color: 0x1abc9c },
  'commish-hub-league':   { title: '📋 Commissioner League Hub', description: 'Commissioner league management — hub display, strike management, and league operations.', color: 0x95a5a6 },

  // ── Components (V199.1) ─────────────────────────────────────────
  'mvp-voting':           { title: '⭐ MVP Voting', description: 'Vote for the weekly MVP using the dropdown. One vote per member.', color: 0xf1c40f },
  'availability':         { title: '📆 Availability', description: 'Post your weekly availability. Available, Limited, or Unavailable.', color: 0x3498db },
  'predictions':          { title: '🔮 Predictions', description: 'Pick your winners for the week. Predictions lock when the week advances.', color: 0x9b59b6 },

  // ── Sports news (V199.1) ────────────────────────────────────────
  'nfl-updates':          { title: '🏈 NFL Updates', description: 'NFL news and updates. Read-only.', color: 0xf39c12 },
  'nfl-chat':             { title: '🏈 NFL Chat', description: 'NFL discussion. Talk games, trades, draft, and storylines.', color: 0xf39c12 },
  'nba-chat':             { title: '🏀 NBA Chat', description: 'NBA discussion. Talk games, trades, free agency, and storylines.', color: 0xf39c12 },

  // ── Events (V199.1) ────────────────────────────────────────────
  'event-signups':        { title: '📝 Event Signups', description: 'RSVP for upcoming events using the posted buttons.', color: 0xf1c40f },

  // ── Server ops (V199.1) ────────────────────────────────────────
  'patch-notes':          { title: '📄 Patch Notes', description: 'Bot update history and changelog. Read-only — posted automatically.', color: 0x95a5a6 },
  'community-selector':   { title: '🧩 Community Selector', description: 'Choose the communities you want access to. Use the dropdown to update your spaces.', color: 0x5865f2 },
  'timezone-gate':        { title: '🕐 Timezone Setup', description: 'Set your timezone to unlock full server access.', color: 0x5865f2 },
};

// ── V199: Channel-to-command/action map ─────────────────────────
// Maps channel names to the commands and interactive actions available in that channel.
// getGuideForChannel dynamically appends these to the guide description.
// Commissioner-only commands marked with (Comm). Member-usable unmarked.
const CHANNEL_COMMANDS = {
  // ── Welcome / Info ──────────────────────────────────────────
  'welcome':              { commands: ['`/send-welcome` — Resend the welcome message (Comm)'] },
  'rules':                { commands: ['`/set-rules` — Replace full rules text (Comm)', '`/update-rule` — Edit a specific rule section (Comm)', '`/append-rule` — Add a new rule (Comm)', '`/customize-server-rules` — Open the rules editor modal (Comm)'] },
  'server-guide':         { commands: ['`/manual` — Open the bot manual and PDF'] },
  'how-to-join':          { commands: ['`/join-league` — Request to join a league', '`/select-team` — Claim an open team'] },
  'announcements':        { commands: ['Read-only — staff announcements only'], actions: ['Broadcasts from `/broadcasts` appear here'] },
  'polls':                { commands: ['`/create-poll` — Create a new poll (Comm)'], actions: ['Vote using the dropdown selector on each poll'] },

  // ── Community ───────────────────────────────────────────────
  'general-chat':         { commands: ['@mention the bot to talk with AI', '`/set-timezone` — Set your timezone', '`/player` — Look up a player\'s stats and info'], actions: ['AI responds to @mentions with the member persona'] },
  'introductions':        { commands: ['Post freely — introduce yourself to the community'] },
  'media-share':          { commands: ['Post images, videos, links, and media'] },
  'off-topic':            { commands: ['Post freely — anything that doesn\'t fit elsewhere'] },

  // ── Discipline ──────────────────────────────────────────────
  'active-check':         { commands: ['`/active-check-status` — View miss counts (Comm)'], actions: ['Reply in channel when tagged to confirm you are active', '5 consecutive misses = automatic removal from the server'] },
  'warnings-log':         { commands: ['`/warn-player` — Issue a warning (Comm)', '`/member-record history` — View member history (Comm)'], actions: ['Read-only — warnings posted automatically'] },
  'boot-log':             { commands: ['`/ban add` — Ban a member (Comm)', '`/ban remove` — Unban (Comm)', '`/ban list` — View ban list (Comm)'], actions: ['Read-only — kicks, bans, and departures logged automatically'] },

  // ── Staff / Admin ───────────────────────────────────────────
  'commissioner-ai':      { commands: ['@mention the bot to talk with commissioner AI', '`/diagnose` — Run full bot diagnostic', '`/health-status` — System health check', '`/audit-log` — View security audit log', '`/workflow` — Inspect workflow status', '`/respond` — Send a bot response to a channel (Comm)'], actions: ['Commissioner AI responds to @mentions with full server awareness', 'Ask "what\'s broken?" for live diagnostic report'] },
  'admin-hq':             { commands: ['`/diagnose` — Full diagnostic report', '`/health-status` — System health', '`/audit-wiring` — Check bot wiring', '`/security-audit` — Security status', '`/hierarchy-status` — Role hierarchy', '`/lock-bot-access` — Re-lock bot permissions', '`/fix-duplicates` — Remove duplicate categories', '`/add-admin` — Grant admin role (Comm)', '`/remove-admin` — Revoke admin role (Comm)', '`/list-admins` — Show all admins (Comm)', '`/logger` — Configure logging (Comm)', '`/edit-message` — Edit a bot message by ID (Comm)', '`/audit-emojis` — Audit emoji usage (Comm)', '`/sync-emojis` — Sync emoji bank (Comm)', `\`${_cmdPath('process-builder')}\` — Create a managed process (Comm)`, `\`${_cmdPath('process-run')}\` — Execute a managed process (Comm)`] },
  'commish-hub':          { commands: ['`/dashboard` — Server dashboard', '`/member-record` — View/note member records', '`/list-communities` — Show all communities', '`/setup-community` — Create a new community (Comm)', '`/edit-community` — Rename a community (Comm)', '`/delete-community` — Remove a community (Comm)', '`/toggle-team-mode` — Change community team mode (Comm)', '`/toggle-feature` — Enable/disable bot features (Comm)', '`/list-features` — Show feature toggle status (Comm)', '`/post-component` — Post an interactive panel (Comm)', '`/suggestions` — View member suggestions (Comm)', '`/set-bot-identity` — Change bot name/avatar (Comm)', '`/set-bot-tone` — Configure AI personality (Comm)', '`/reset-customization` — Reset tone/identity to defaults (Comm)'], actions: ['Upload screenshots and notes for commissioner reference'] },
  'scoresheets':          { commands: ['`/league-data-ingest` — Import schedule/stats data', '`/schedule-import` — Import a schedule file', '`/report-result` — Submit a game result (Comm)', '`/retract-score` — Retract a submitted score (Comm)', '`/league-export` — Export league data (Comm)'], actions: ['Upload screenshots — bot AI can parse them'] },
  'setup-wizard':         { commands: ['`/setup-wizard-start` — Reopen the setup wizard', '`/setup-server` — Quick server setup', '`/trash-the-bot` — Full reset (Comm)', '`/initialize-server` — Reinitialize (Comm)', '`/setup-league` — Create a new league (Comm)', '`/delete-league` — Delete an active league (Comm)', '`/reset-league` — Reset and rebuild a league (Comm)', '`/start-season` — Begin the season (Comm)'], actions: ['Use the wizard buttons and dropdowns to configure the server'] },

  // ── League — Scheduling ─────────────────────────────────────
  'weekly-schedule':      { commands: ['`/advance-week` — Post new weekly schedule (Comm)', `\`${_cmdPath('repost-schedule')}\` — Repost current schedule (Comm)`, '`/schedule-load-week` — Load a week from registry (Comm)', '`/release-week` — Release current week results (Comm)', `\`${_cmdPath('schedule-registry-status')}\` — View schedule registry (Comm)`], actions: ['Read-only — schedule posted automatically when week advances'] },
  'scores-and-standings': { commands: ['`/post-standings` — Post current standings (Comm)', `\`${_cmdPath('hub-status')}\` — View hub week status (Comm)`, '`/set-hub-week` — Set the hub display week (Comm)'], actions: ['Read-only — standings auto-update when results are submitted'] },
  'open-teams':           { commands: ['`/open-teams` — View available teams', '`/select-team` — Claim a team', '`/register-team` — Register as a team owner', '`/refresh-open-teams` — Refresh the board (Comm)', '`/add-open-team` / `/remove-open-team` — Manage roster (Comm)', '`/fill-cpu` — Fill empty slots with CPU (Comm)', '`/release-cpu` — Remove CPU from a slot (Comm)', '`/release-team` — Release a claimed team (Comm)', '`/waitlist` — View or join the team waitlist'] },

  // ── League — Teams ──────────────────────────────────────────
  'team-chat':            { commands: ['`/teams` — View all teams', '`/team-registry-status` — View team registry health (Comm)', '`/setup-team` — Configure a team space (Comm)', '`/set-team-identity` — Set team name/logo (Comm)', '`/set-team-logo` — Set team logo URL (Comm)'], actions: ['Team-specific discussion channel'] },
  'league-chat':          { commands: ['`/teams` — View all teams and rosters', '`/add-member-to-league` — Add a member to the league (Comm)', `\`${_cmdPath('set-league-source-mode')}\` — Set data source mode (Comm)`], actions: ['General league discussion'] },

  // ── League — Trades ─────────────────────────────────────────
  'pending-trades':       { commands: ['`/propose-trade` — Submit a trade proposal'], actions: ['Trade proposals appear here for commissioner review'] },
  'accepted-trades':      { actions: ['Read-only — approved trades logged here'] },
  'declined-trades':      { actions: ['Read-only — declined trades logged here'] },
  'transactions':         { commands: ['`/transaction` — Log a roster transaction (Comm)'], actions: ['Read-only — trades, signings, releases, and moves logged here'] },
  'trade-block':          { actions: ['Click "Update My Trade Block" to list players you want to trade', 'Trade block updates visible to all members'] },

  // ── League — Rewards ────────────────────────────────────────
  'rewards':              { commands: ['`/refresh-rewards` — Refresh all boards (Comm)', '`/rewards-board` — View reward boards', '`/yearly-award` — Record a yearly award (Comm)'], actions: ['Read-only — POTW, streams, yearly awards auto-update here'] },
  'stat-leaders':         { commands: ['`/set-stat-leaders` — Update stat leaders (Comm)'], actions: ['Read-only — stat leader board auto-updates'] },
  'player-of-the-week':   { commands: ['`/player-of-the-week` — Nominate POTW (Comm)', '`/potw-confirm` — Confirm AI pick or override (Comm)', `\`${_cmdPath('cancel-potw-timer')}\` — Cancel the POTW auto-timer (Comm)`], actions: ['Read-only — POTW winners posted here'] },
  'dev-upgrades':         { commands: ['`/attr-award` — Award attribute boost (Comm)', '`/claim-attr-boost` — Request an attribute boost'], actions: ['Boost awards and claims logged here'] },
  'superbowl-history':    { commands: ['`/superbowl-champion` — Record champion (Comm)'], actions: ['Read-only — championship history'] },

  // ── League — Streams ────────────────────────────────────────
  'livestreams':          { commands: ['`/streams` — Configure stream tracking (Comm)', '`/my-streams` — Check your stream credit count', `\`${_cmdPath('restore-stream')}\` — Restore a stream credit (Comm)`, '`/stream-board` — View stream leaderboard'], actions: ['Post your stream link here to earn credit'] },

  // ── League — Games ──────────────────────────────────────────
  'game-results':         { commands: ['`/report-result` — Submit a game score (Comm)', '`/retract-score` — Retract a submitted score (Comm)', '`/create-game` — Create a manual game channel (Comm)', '`/game-channels` — Manage game channels (Comm)'], actions: ['Click "Submit Result" to enter your game score', 'Results auto-posted with win/loss color coding'] },
  'game-of-the-week':     { actions: ['Read-only — featured matchup of the week'] },
  'schedule-board':       { commands: ['`/advance-week` — Advance to the next week (Comm)', '`/release-week` — Release current week (Comm)', `\`${_cmdPath('cancel-release-timer')}\` — Cancel auto-release timer (Comm)`], actions: ['Read-only — weekly matchup schedule'] },
  'league-announcements': { commands: ['`/broadcasts` — Configure broadcasts (Comm)'], actions: ['Read-only — official league updates'] },
  'trash-talk':           { actions: ['Pre-game and post-game banter — keep it fun'] },

  // ── League — Live Sync ──────────────────────────────────────
  'live-sync':            { commands: [`\`${_cmdPath('live-sync-now')}\` — Force immediate sync (Comm)`, `\`${_cmdPath('live-sync-status')}\` — View sync health (Comm)`, '`/set-live-sync` — Configure sync endpoint (Comm)'], actions: ['Read-only — live data sync status'] },

  // ── League — Hub ────────────────────────────────────────────
  'commish-hub-league':   { commands: [`\`${_cmdPath('clear-hub')}\` — Clear hub display (Comm)`, `\`${_cmdPath('hub-status')}\` — View hub state (Comm)`, '`/set-hub-week` — Set displayed week (Comm)', '`/clear-strikes` — Reset a member\'s strikes (Comm)'], actions: ['Commissioner league management dashboard'] },

  // ── Component channels ──────────────────────────────────────
  'mvp-voting':           { actions: ['Use the dropdown to vote for weekly MVP', 'One vote per member — change your vote anytime'] },
  'availability':         { actions: ['Click 🟢 Available, 🟡 Limited, or 🔴 Unavailable', 'Updates your availability for the current week'] },
  'predictions':          { actions: ['Click "Make Predictions" to pick your winners', 'Predictions lock when the week advances'] },

  // ── Educational ─────────────────────────────────────────────
  'resources':            { actions: ['Read-only — staff posts study materials and links'] },
  'questions':            { actions: ['Ask questions — community and AI can help'] },
  'study-hall':           { actions: ['Study discussion and collaboration space'] },
  'projects':             { actions: ['Post project updates, find collaborators'] },
  'office-hours':         { actions: ['Read-only — staff posts office hours schedule'] },

  // ── Gaming ──────────────────────────────────────────────────
  'game-chat':            { commands: ['@mention the bot for game-specific AI chat'] },
  'squad-up':             { actions: ['Post your game, platform, and availability to find squads'] },
  'match-hub':            { actions: ['Coordinate matches and post results'] },
  'clips-and-highlights': { actions: ['Post your best plays and highlight reels'] },
  'looking-for-group':    { actions: ['Post your game, rank, and times to find groups'] },

  // ── Sports ──────────────────────────────────────────────────
  'nfl-updates':          { commands: ['`/post-nfl-news` — Post NFL news (Comm)'], actions: ['Read-only — NFL news and updates'] },
  'nfl-chat':             { commands: ['@mention the bot for NFL discussion'] },
  'nba-chat':             { commands: ['@mention the bot for NBA discussion'] },

  // ── Events ──────────────────────────────────────────────────
  'event-calendar':       { commands: ['`/setup-event` — Create an event (Comm)'], actions: ['Read-only — upcoming events posted here'] },
  'event-signups':        { actions: ['RSVP for events using posted buttons'] },
  'watch-party-planning': { actions: ['Coordinate watch party times and links'] },

  // ── Server ops ──────────────────────────────────────────────
  'patch-notes':          { actions: ['Read-only — bot update history posted automatically'] },
  'community-selector':   { actions: ['Use the dropdown to choose your communities', 'Selecting a community grants you access to its channels'] },
  'timezone-gate':        { commands: ['`/set-timezone` — Set your timezone'], actions: ['Set your timezone to unlock full server access'] },
};

/**
 * Get the guide embed for a channel name.
 * V199 FIX: Dynamically appends commands and actions to every guide.
 * @param {string} channelName - lowercase channel name (no emoji prefix)
 * @returns {{ title: string, description: string, color: number } | null}
 */
function getGuideForChannel(channelName) {
  if (!channelName) return null;
  const name = String(channelName).toLowerCase().replace(/^[^\w-]+/, '').trim();
  const guide = CHANNEL_GUIDES[name];
  if (!guide) return null;

  // Enrich with commands and actions
  const cmdEntry = CHANNEL_COMMANDS[name];
  if (!cmdEntry) return { ...guide };

  let enriched = guide.description;
  if (cmdEntry.commands && cmdEntry.commands.length) {
    enriched += '\n\n**Commands:**\n' + cmdEntry.commands.map(c => `• ${c}`).join('\n');
  }
  if (cmdEntry.actions && cmdEntry.actions.length) {
    enriched += '\n\n**Actions:**\n' + cmdEntry.actions.map(a => `• ${a}`).join('\n');
  }

  return { title: guide.title, description: enriched, color: guide.color };
}

/**
 * Check if a guide exists for a channel name.
 */
function hasGuide(channelName) {
  return !!getGuideForChannel(channelName);
}

/**
 * Get all known channel names.
 */
function getAllChannelNames() {
  return Object.keys(CHANNEL_GUIDES);
}

/**
 * Get just the commands/actions block for a channel (no title/description/color).
 * Used by postBaseGuideMessages to append commands to custom embeds.
 * @param {string} channelName
 * @returns {string} — formatted commands text or empty string
 */
function getCommandsBlock(channelName) {
  if (!channelName) return '';
  const name = String(channelName).toLowerCase().replace(/^[^\w-]+/, '').trim();
  const cmdEntry = CHANNEL_COMMANDS[name];
  if (!cmdEntry) return '';
  const parts = [];
  if (cmdEntry.commands && cmdEntry.commands.length) {
    parts.push('**Commands:**\n' + cmdEntry.commands.map(c => `• ${c}`).join('\n'));
  }
  if (cmdEntry.actions && cmdEntry.actions.length) {
    parts.push('**Actions:**\n' + cmdEntry.actions.map(a => `• ${a}`).join('\n'));
  }
  return parts.length ? '\n\n' + parts.join('\n\n') : '';
}

module.exports = { CHANNEL_GUIDES, CHANNEL_COMMANDS, getGuideForChannel, getCommandsBlock, hasGuide, getAllChannelNames };
