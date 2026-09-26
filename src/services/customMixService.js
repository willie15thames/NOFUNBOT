/*
 * NAVIGATION HEADER
 * FILE: src/services/customMixService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
/**
 * customMixService.js
 * Maps mix-and-match selection keys to actual categories/channels.
 * Called by createTemplateStructure when customCatalogSelections exist.
 */

// Each key maps to { categoryName, channels: [[name, readOnly?], ...] }
const MIX_CHANNEL_MAP = {
  // ── Gaming ────────────────────────────────────────────────────
  'gaming:general': {
    category: '🎮 Gaming Hub',
    channels: [['game-chat'], ['squad-up'], ['clips-and-highlights'], ['looking-for-group']],
  },
  'gaming:cod': {
    category: '🎯 COD Ops',
    channels: [['warzone-lfg'], ['ranked-grind'], ['loadouts-and-metas'], ['clips-and-highlights'], ['patch-watch', true]],
  },
  'gaming:gta': {
    category: '🚗 GTA City',
    channels: [['crew-recruiting'], ['heist-board'], ['rp-talk'], ['races-and-meets'], ['clips-and-chaos']],
  },
  'gaming:sportssim': {
    category: '🏀 Sports Sim League',
    channels: [['team-talk'], ['scores-and-standings', true], ['schedule-board', true], ['match-lobby'], ['trade-block']],
  },
  'gaming:apex': {
    category: '🪂 Apex Ops',
    channels: [['squad-up'], ['legend-talk'], ['ranked-grind'], ['clip-review'], ['patch-watch', true]],
  },
  'gaming:minecraft': {
    category: '⛏ Minecraft Realm',
    channels: [['realm-chat'], ['build-showcase'], ['mod-pack-talk'], ['events-and-raids']],
  },
  'gaming:roblox': {
    category: '🧱 Roblox Hub',
    channels: [['experience-talk'], ['studio-help'], ['squad-up'], ['game-night']],
  },
  'gaming:esports': {
    category: '🏅 Esports HQ',
    channels: [['roster-room'], ['scrim-planning'], ['vod-review'], ['tournament-bracket', true], ['match-prep']],
  },
  'gaming:fighter': {
    category: '🥊 Fighting Game Corner',
    channels: [['set-finder'], ['matchup-talk'], ['tech-and-combos'], ['tournament-signups'], ['tier-list-talk']],
  },
  'gaming:racing': {
    category: '🏎 Racing Grid',
    channels: [['lobby-finder'], ['tuning-talk'], ['race-calendar', true], ['results-board', true], ['car-showcase']],
  },
  'gaming:mobile': {
    category: '📱 Mobile Gaming Club',
    channels: [['squad-up'], ['meta-talk'], ['event-chat'], ['clan-recruiting'], ['patch-watch', true]],
  },
  'gaming:variety': {
    category: '🎲 Variety Lounge',
    channels: [['what-are-we-playing'], ['looking-for-group'], ['co-op-planning'], ['game-recommendations']],
  },

  // ── Sports ────────────────────────────────────────────────────
  'sports:nfl': {
    category: '🏈 NFL Sunday Hub',
    channels: [['gameday-redzone'], ['nfl-scores', true], ['team-talk'], ['fantasy-talk'], ['watch-party-planning']],
  },
  'sports:nba': {
    category: '🏀 NBA Nightly Run',
    channels: [['game-night-chat'], ['nba-highlights', true], ['fantasy-hoops'], ['player-debates'], ['watch-party-planning']],
  },
  'sports:soccer': {
    category: '⚽ Soccer Pitch Side',
    channels: [['match-day-chat'], ['league-standings', true], ['transfer-talk'], ['watch-party-planning']],
  },
  'sports:baseball': {
    category: '⚾ Baseball Diamond',
    channels: [['game-day-chat'], ['scores-and-stats', true], ['fantasy-talk'], ['trade-machine']],
  },
  'sports:hockey': {
    category: '🏒 Hockey Rink',
    channels: [['game-night-chat'], ['highlights', true], ['fantasy-hockey'], ['trade-talk']],
  },
  'sports:fitness': {
    category: '🏋 Fitness League',
    channels: [['workout-log'], ['challenge-board', true], ['progress-pics'], ['motivation'], ['nutrition-talk']],
  },
  'sports:golf': {
    category: '🏌 Golf Club',
    channels: [['course-chat'], ['fantasy-golf'], ['handicap-board', true], ['tips-and-swing']],
  },
  'sports:combat': {
    category: '🥊 Combat Sports',
    channels: [['event-hype'], ['results-and-reactions', true], ['fantasy-picks'], ['fight-breakdowns']],
  },

  // ── Community ─────────────────────────────────────────────────
  'community:social': {
    category: '💬 Social Lounge',
    channels: [['general-chat'], ['introductions'], ['off-topic'], ['memes-and-media']],
  },
  'community:edu': {
    category: '🎓 Study & Learning',
    channels: [['study-groups'], ['resource-share'], ['q-and-a'], ['progress-check'], ['study-streak']],
  },
  'community:pro': {
    category: '💼 Professional Network',
    channels: [['career-talk'], ['portfolio-showcase'], ['networking'], ['industry-news', true], ['opportunities']],
  },
  'community:events': {
    category: '🎭 Events & Activities',
    channels: [['event-calendar', true], ['event-signups'], ['event-chat'], ['event-highlights']],
  },
  'community:creative': {
    category: '🎨 Creative Corner',
    channels: [['art-showcase'], ['feedback'], ['collab-requests'], ['wip-channel'], ['inspiration']],
  },
  'community:music': {
    category: '🎵 Music Scene',
    channels: [['artist-chat'], ['playlist-drops'], ['production-talk'], ['concert-talk'], ['new-releases']],
  },
  'community:cyber': {
    category: '🛡 Security & Cyber',
    channels: [['threat-intel'], ['lab-notes'], ['cert-study'], ['blue-team-chat'], ['tool-talk']],
  },
  'community:coding': {
    category: '💻 Dev Hub',
    channels: [['help-and-debug'], ['project-showcase'], ['code-review'], ['repo-share'], ['tech-talk']],
  },
  'community:language': {
    category: '🌐 Language Exchange',
    channels: [['practice-chat'], ['vocab-swap'], ['culture-corner'], ['correction-zone'], ['resource-share']],
  },
  'community:wellness': {
    category: '💚 Wellness Space',
    channels: [['check-in'], ['safe-space'], ['resources', true], ['gratitude-log'], ['quiet-zone']],
  },

  // ── Media & Fandom ────────────────────────────────────────────
  'media:movies': {
    category: '🎬 Movies & Film',
    channels: [['now-watching'], ['reviews'], ['recommendations'], ['watch-party-planning'], ['classic-films']],
  },
  'media:tv': {
    category: '📺 TV & Streaming',
    channels: [['show-talk'], ['binge-watch'], ['recommendations'], ['spoiler-zone'], ['schedule-board', true]],
  },
  'media:anime': {
    category: '🍜 Anime Universe',
    channels: [['seasonal-watch'], ['manga-talk'], ['recommendations'], ['fan-art'], ['reaction-chat']],
  },
  'media:books': {
    category: '📚 Books & Comics',
    channels: [['book-club'], ['comic-talk'], ['reviews'], ['recommendations'], ['lore-deep-dives']],
  },
  'media:marvel': {
    category: '🦸 Marvel Universe',
    channels: [['mcu-reactions'], ['comic-lore'], ['theory-crafting'], ['news-and-releases', true]],
  },
  'media:scifi': {
    category: '⚡ Star Wars & Sci-Fi',
    channels: [['lore-talk'], ['theory-crafting'], ['watch-nights'], ['new-releases', true], ['fan-art']],
  },
  'media:disney': {
    category: '🏰 Disney & Animation',
    channels: [['fan-talk'], ['park-chat'], ['new-releases', true], ['watch-parties'], ['nostalgia-zone']],
  },
  'media:musicfan': {
    category: '🎤 Music Fan Hub',
    channels: [['artist-talk'], ['new-drops'], ['concert-chat'], ['fan-theories'], ['playlist-share']],
  },
  'media:wrestling': {
    category: '🤼 Pro Wrestling',
    channels: [['event-hype'], ['results-reactions', true], ['fantasy-booking'], ['promo-chat'], ['throwbacks']],
  },
  'media:news': {
    category: '📰 News & Current Events',
    channels: [['headlines', true], ['discussion'], ['fact-check-zone'], ['global-news'], ['local-talk']],
  },
};

/**
 * Build channel specs from mix-and-match selections.
 * Returns array of { categoryName, channels: [[name, readOnly?], ...] }
 * Merges channels from same-category selections into one category.
 */
function buildChannelSpecs(customSelections = []) {
  const categoryMap = new Map(); // categoryName → Set of channel specs

  for (const key of customSelections) {
    const spec = MIX_CHANNEL_MAP[key];
    if (!spec) continue;

    const catName = spec.category;
    if (!categoryMap.has(catName)) {
      categoryMap.set(catName, []);
    }
    for (const ch of spec.channels) {
      const existing = categoryMap.get(catName);
      const chName = ch[0];
      // Deduplicate channels within same category
      if (!existing.some(e => e[0] === chName)) {
        existing.push(ch);
      }
    }
  }

  const result = [];
  for (const [categoryName, channels] of categoryMap) {
    result.push({ categoryName, channels });
  }
  return result;
}

/**
 * Summary of what will be built from selections.
 */
function buildSelectionSummary(customSelections = []) {
  const specs = buildChannelSpecs(customSelections);
  if (!specs.length) return 'No custom spaces selected.';
  const parts = specs.map(s => `${s.categoryName} (${s.channels.length} ch)`);
  return parts.join(', ');
}

// Community banner images — one per major community type
const path = require('path');
const COMMUNITY_BANNERS = {
  'gaming:general':    'gaming-general.png',
  'gaming:cod':        'gaming-cod.png',
  'gaming:gta':        'gaming-gta.png',
  'gaming:sportssim':  'gaming-sportssim.png',
  'gaming:esports':    'gaming-esports.png',
  'gaming:variety':    'gaming-variety.png',
  'sports:nfl':        'sports-nfl.png',
  'sports:nba':        'sports-nba.png',
  'sports:fitness':    'sports-fitness.png',
  'sports:combat':     'sports-combat.png',
  'community:social':  'community-social.png',
  'community:edu':     'community-edu.png',
  'community:coding':  'community-coding.png',
  'community:cyber':   'community-cyber.png',
  'community:wellness':'community-wellness.png',
  'community:creative':'community-creative.png',
  'media:movies':      'media-movies.png',
  'media:anime':       'media-anime.png',
  'media:marvel':      'media-marvel.png',
  'media:wrestling':   'media-wrestling.png',
  'media:news':        'media-news.png',
};

function getBannerPath(selectionKey) {
  const file = COMMUNITY_BANNERS[selectionKey];
  if (!file) return null;
  return path.join(__dirname, '..', '..', 'assets', 'community-banners', file);
}

function getBannerFile(selectionKey) {
  return COMMUNITY_BANNERS[selectionKey] || null;
}

module.exports = { MIX_CHANNEL_MAP, buildChannelSpecs, buildSelectionSummary, COMMUNITY_BANNERS, getBannerPath, getBannerFile };
