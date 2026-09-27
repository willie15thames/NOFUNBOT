/*
 * NAVIGATION HEADER
 * FILE: src/services/serverSettingsService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
const { loadJson, saveJson } = require('../storage/jsonStore');
const FILE = 'serverSettings.json';

const TONE_OPTIONS = {
  g: ['SpongeBob','Ash Ketchum','Bluey','Courage','Aang','Yoda','Mario','Kirby','Mickey Mouse','Bugs Bunny','Scooby-Doo','Pooh','Tails'],
  pg: ['Batman','Sonic','Shrek','Spider-Man','Optimus Prime','Genie','Po','Raphael','Donkey','Ben 10','Buzz Lightyear','Korra','Mr. Incredible'],
  pg13: ['Jack Sparrow','Tony Stark','Wednesday Addams','Harley Quinn','Darth Vader','John Wick','Rocky','Morpheus','Selene','Kevin Hart','Tyler Perry','Roast Comic','Petty Announcer','Reckless Banter','House M.D.','Sterling Archer','Bender','Megan Thee Stallion Energy','Fast-Talk Instigator','Shakespeare'],
  r: ['Ghostface','Samuel L. Jackson','Stewie Griffin','Rick Sanchez','Blade','Negan','Trevor Philips','Deadpool','Tyler Durden','Omar Little','The Joker','Ron Burgundy','Cleveland Brown','Chaos Roast','Unhinged Rival','Volcanic Trash Talk','Dave Chappelle','Katt Williams','Alonzo Harris','Sue Sylvester','Boondocks Energy','Shakespeare'],
  professional: ['Butler','Sports Anchor','Concierge','Coach','Analyst'],
  quick: ['One-Liner','Deadpan','Blunt'],
  enthusiastic: ['Hype','Showtime'],
  sarcastic: ['Dry Sarcasm','Wet Sarcasm','Petty Sarcasm','Smart Mouth','Shakespearean Venom'],
  plain: ['Straight','Simple','Calm','Measured'],
};

const AUDIENCE_ORDER = ['g', 'pg', 'pg13', 'r'];

function getAllowedTonesForAudience(rating = '') {
  const clean = String(rating || '').trim().toLowerCase();
  // Empty rating = no audience set yet → allow ALL tones so saved tones are never silently stripped
  // before the commissioner finishes setup. They only get pruned once an audience is explicitly chosen.
  const idx = AUDIENCE_ORDER.includes(clean) ? AUDIENCE_ORDER.indexOf(clean) : AUDIENCE_ORDER.length - 1;
  const baseCore = [
    'Butler','Straight','Dry Sarcasm','Wet Sarcasm','Shakespearean Venom','Simple','Measured','Calm',
    'One-Liner','Deadpan','Blunt','Hype','Showtime','Sports Anchor','Coach','Analyst'
  ];
  const priority = [];
  const seen = new Set();
  const pushMany = (items = []) => {
    for (const item of items) {
      const val = String(item || '').trim();
      if (!val || seen.has(val)) continue;
      seen.add(val);
      priority.push(val);
      if (priority.length >= 25) return;
    }
  };

  // Include all tones up to and including the chosen audience tier
  for (let i = idx; i >= 0; i -= 1) pushMany(TONE_OPTIONS[AUDIENCE_ORDER[i]] || []);
  pushMany(baseCore);
  pushMany(TONE_OPTIONS.professional);
  pushMany(TONE_OPTIONS.quick);
  pushMany(TONE_OPTIONS.enthusiastic);
  pushMany(TONE_OPTIONS.sarcastic);
  pushMany(TONE_OPTIONS.plain);
  return priority.slice(0, 25);
}

const DEFAULTS = {
  audienceRating: 'pg13',
  toneProfile: [],
  memberToneProfile: [],
  commissionerToneProfile: [],
  useSharedToneProfile: false,
  setupCompletedAt: null,
  botName: 'myBot',
  avatarMode: 'server_image',
  avatarUrl: null,
  avatarEmoji: null,
  serverTemplate: '',
  serverSubtemplate: '',
  architectureIntent: 'server_management_setup_wizard_personality_ai',
  customStructureMode: '',
  customArrangementMode: 'auto',
  customCatalogSelections: [],
  customTemplateSelections: [],
  customSubtemplateSelections: [],
  serverInitialized: false,
  allowGifReplies: true,
  communities: [],           // [{name, type, createdAt}] — communities defined by commissioner
  requireTimezone: false,
  filterMode: 'relaxed',
  toneVisibility: 'public',
  botStatus: 'active',
  ageWarningEnabled: true,
  lastAppliedName: null,
  lastAppliedAvatar: null,
  updatedAt: null,
};

function getSettings() {
  const raw = loadJson(FILE, null);
  return { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
}

function sanitizeToneProfile(input, audienceRating = '') {
  // Empty string defaults to pg13 — never silently strip all tones on a fresh install
  const effectiveRating = String(audienceRating || 'pg13').trim().toLowerCase();
  const allowed = new Set(getAllowedTonesForAudience(effectiveRating));
  const arr = Array.isArray(input) ? input : [];
  const out = [];
  for (const item of arr) {
    const val = String(item || '').trim();
    if (!val || !allowed.has(val) || out.includes(val)) continue;
    out.push(val);
    if (out.length >= 7) break;
  }
  return out;
}

function sanitizeBool(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeBotName(value) {
  const raw = String(value || '').trim();
  const clean = raw.replace(/\s+/g, ' ').slice(0, 32);
  return clean || DEFAULTS.botName;
}

function sanitizeAvatarMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ['server_image', 'url', 'emoji_url'].includes(mode) ? mode : DEFAULTS.avatarMode;
}

function sanitizeAvatarUrl(value) {
  const raw = String(value || '').trim();
  return /^https?:\/\//i.test(raw) ? raw : null;
}

function sanitizeCustomStructureMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ['base', 'template', 'custom'].includes(mode) ? mode : '';
}

function sanitizeArrangementMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ['auto', 'manual'].includes(mode) ? mode : DEFAULTS.customArrangementMode;
}

function sanitizeCatalogSelections(value) {
  const arr = Array.isArray(value) ? value : [];
  const out = [];
  for (const item of arr) {
    const val = String(item || '').trim();
    if (!val || out.includes(val)) continue;
    out.push(val);
    if (out.length >= 25) break;
  }
  return out;
}

function sanitizeAudienceRating(value) {
  const rating = String(value || '').trim().toLowerCase();
  return AUDIENCE_ORDER.includes(rating) ? rating : '';
}

function saveSettings(next) {
  const current = getSettings();
  const audienceRating = sanitizeAudienceRating(next?.audienceRating ?? current.audienceRating);
  const shared = sanitizeToneProfile(next?.toneProfile ?? current.toneProfile, audienceRating);
  const useShared = sanitizeBool(next?.useSharedToneProfile ?? current.useSharedToneProfile, DEFAULTS.useSharedToneProfile);
  const memberTone = sanitizeToneProfile(next?.memberToneProfile ?? current.memberToneProfile ?? shared, audienceRating);
  const commissionerTone = sanitizeToneProfile(next?.commissionerToneProfile ?? current.commissionerToneProfile ?? [], audienceRating);
  const out = {
    ...DEFAULTS,
    ...next,
    audienceRating,
    toneProfile: shared,
    memberToneProfile: useShared ? shared : memberTone,
    commissionerToneProfile: useShared ? shared : commissionerTone,
    useSharedToneProfile: useShared,
    botName: sanitizeBotName(next?.botName ?? current.botName),
    avatarMode: sanitizeAvatarMode(next?.avatarMode ?? current.avatarMode),
    avatarUrl: sanitizeAvatarUrl(next?.avatarUrl ?? current.avatarUrl),
    avatarEmoji: String(next?.avatarEmoji ?? current.avatarEmoji ?? '').trim() || null,
    serverTemplate: String(next?.serverTemplate ?? current.serverTemplate ?? '').trim().toLowerCase(),
    serverSubtemplate: String(next?.serverSubtemplate ?? current.serverSubtemplate ?? '').trim().toLowerCase(),
    architectureIntent: String(next?.architectureIntent ?? current.architectureIntent ?? DEFAULTS.architectureIntent).trim() || DEFAULTS.architectureIntent,
    customStructureMode: sanitizeCustomStructureMode(next?.customStructureMode ?? current.customStructureMode),
    customArrangementMode: sanitizeArrangementMode(next?.customArrangementMode ?? current.customArrangementMode),
    customCatalogSelections: sanitizeCatalogSelections(next?.customCatalogSelections ?? current.customCatalogSelections),
    customTemplateSelections: sanitizeCatalogSelections(next?.customTemplateSelections ?? current.customTemplateSelections),
    customSubtemplateSelections: sanitizeCatalogSelections(next?.customSubtemplateSelections ?? current.customSubtemplateSelections),
    allowGifReplies: sanitizeBool(next?.allowGifReplies ?? current.allowGifReplies, DEFAULTS.allowGifReplies),
    requireTimezone: sanitizeBool(next?.requireTimezone ?? current.requireTimezone, DEFAULTS.requireTimezone),
    filterMode: (() => {
      const v = String(next?.filterMode ?? current.filterMode ?? DEFAULTS.filterMode).toLowerCase();
      return ['strict','relaxed','unfiltered_style'].includes(v) ? v : DEFAULTS.filterMode;
    })(),
    toneVisibility: (() => {
      const v = String(next?.toneVisibility ?? current.toneVisibility ?? DEFAULTS.toneVisibility).toLowerCase();
      return ['public','commissioners','channel_based'].includes(v) ? v : DEFAULTS.toneVisibility;
    })(),
    botStatus: (() => {
      const v = String(next?.botStatus ?? current.botStatus ?? DEFAULTS.botStatus).toLowerCase();
      return ['active','killed'].includes(v) ? v : DEFAULTS.botStatus;
    })(),
    ageWarningEnabled: sanitizeBool(next?.ageWarningEnabled ?? current.ageWarningEnabled, DEFAULTS.ageWarningEnabled),
    updatedAt: Date.now()
  };
  // v204.7 structure semantics: Base is truly template-free; Template owns one template/subtemplate;
  // Custom owns commissioner-selected template/subtemplate sets. Never leave stale selections behind.
  if (out.customStructureMode === 'base') {
    out.serverTemplate = '';
    out.serverSubtemplate = '';
    out.customTemplateSelections = [];
    out.customSubtemplateSelections = [];
  } else if (out.customStructureMode === 'template') {
    out.customTemplateSelections = [];
    out.customSubtemplateSelections = [];
  } else if (out.customStructureMode === 'custom') {
    out.serverTemplate = '';
    out.serverSubtemplate = '';
  }

  saveJson(FILE, out);

  // Dual-write to Prisma (non-blocking — JSON is still primary)
  try {
    const { getGuildId } = require('./serverConfigBootstrap');
    const { prismaSafe } = require('../storage/prisma');
    const guildId = getGuildId();
    if (guildId) {
      const dbFields = {
        botStatus: out.botStatus || 'active',
        audienceRating: out.audienceRating || 'pg13',
        filterMode: out.filterMode || 'strict',
        botName: out.botName || 'myBot',
        allowGifReplies: !!out.allowGifReplies,
        requireTimezone: !!out.requireTimezone,
        serverInitialized: !!out.serverInitialized,
        useSharedToneProfile: !!out.useSharedToneProfile,
        serverTemplate: out.serverTemplate || null,
        serverSubtemplate: out.serverSubtemplate || null,
        customStructureMode: out.customStructureMode || null,
        customTemplateSelections: out.customTemplateSelections || [],
        customSubtemplateSelections: out.customSubtemplateSelections || [],
        toneProfile: out.toneProfile || [],
        memberToneProfile: out.memberToneProfile || [],
        commToneProfile: out.commissionerToneProfile || [],
        payload: out,
        updatedAt: new Date(),
      };
      prismaSafe(prisma => prisma.serverConfig.upsert({
        where: { guildId: String(guildId) },
        create: { guildId: String(guildId), ...dbFields },
        update: dbFields,
      }), null).catch(() => null);
    }
  } catch (_e) {}

  return out;
}

function setAudienceRating(value) {
  return saveSettings({ ...getSettings(), audienceRating: value, setupCompletedAt: Date.now() });
}

function getEffectiveToneProfile(settings = getSettings(), target = 'shared') {
  const current = settings || getSettings();
  if (target === 'commissioner') {
    return current.useSharedToneProfile ? sanitizeToneProfile(current.toneProfile, current.audienceRating) : sanitizeToneProfile(current.commissionerToneProfile || current.toneProfile, current.audienceRating);
  }
  if (target === 'member') {
    return current.useSharedToneProfile ? sanitizeToneProfile(current.toneProfile, current.audienceRating) : sanitizeToneProfile(current.memberToneProfile || current.toneProfile, current.audienceRating);
  }
  return sanitizeToneProfile(current.toneProfile, current.audienceRating);
}

function setToneProfile(values, target = 'shared') {
  const current = getSettings();
  const cleaned = sanitizeToneProfile(values, current.audienceRating);
  if (target === 'commissioner') return saveSettings({ ...current, commissionerToneProfile: cleaned, setupCompletedAt: Date.now() });
  if (target === 'member') return saveSettings({ ...current, memberToneProfile: cleaned, setupCompletedAt: Date.now() });
  return saveSettings({ ...current, toneProfile: cleaned, memberToneProfile: cleaned, commissionerToneProfile: cleaned, useSharedToneProfile: true, setupCompletedAt: Date.now() });
}

function getToneSummary(settings = getSettings(), target = 'shared') {
  const tones = getEffectiveToneProfile(settings, target);
  return tones.length ? tones.join(', ') : 'Not selected';
}

function setBotIdentity({ botName, avatarMode, avatarUrl, avatarEmoji }) {
  const current = getSettings();
  return saveSettings({
    ...current,
    botName: botName != null ? botName : current.botName,
    avatarMode: avatarMode != null ? avatarMode : current.avatarMode,
    avatarUrl: avatarUrl !== undefined ? avatarUrl : current.avatarUrl,
    avatarEmoji: avatarEmoji !== undefined ? avatarEmoji : current.avatarEmoji,
    setupCompletedAt: Date.now(),
  });
}

function resetInstallationDefaults() {
  const out = { ...DEFAULTS, setupCompletedAt: null, lastAppliedName: null, lastAppliedAvatar: null, updatedAt: Date.now() };
  saveJson(FILE, out);
  return out;
}


function setBotStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (!['active', 'killed'].includes(status)) return getSettings();
  return saveSettings({ ...getSettings(), botStatus: status, setupCompletedAt: Date.now() });
}

function getAudienceWarning(rating = '', filterMode = 'strict') {
  const clean = String(rating || '').trim().toLowerCase();
  const filter = String(filterMode || 'strict').trim().toLowerCase();
  if (clean === 'r') {
    return filter === 'unfiltered_style'
      ? 'R warning: full profanity and explicit trash talk are enabled (fuck, shit, bitch, nigga in persona-authentic context, etc.). Hateful slurs (nigger, faggot, kike, etc.), targeted harassment, doxxing, and violent threats are always blocked.'
      : filter === 'relaxed'
        ? 'R warning: strong profanity, savage roast energy, and aggressive rivalry banter are fully enabled. The bot still blocks hateful slurs, targeted harassment, doxxing, and violent threats.'
        : 'R warning: strong profanity and aggressive rivalry banter are enabled. Hateful slurs, targeted harassment, doxxing, and violent threats stay blocked.';
  }
  if (clean === 'pg13') {
    return filter === 'unfiltered_style'
      ? 'PG-13 warning: sharper trash talk, rude comedy, and reckless attitude are enabled for this audience. The bot still blocks hateful slurs, protected-target harassment, and violent threats.'
      : 'PG-13 warning: sharper trash talk, stronger language, and edgier comedy are enabled. Hateful slurs, protected-target harassment, and violent threats stay blocked.';
  }
  if (clean === 'pg') return 'PG warning: light roast humor and mild attitude are enabled.';
  if (clean === 'g') return 'G warning: clean all-ages responses only.';
  return 'Audience warning not configured yet.';
}

function requiresAgeWarning(rating = '') {
  const clean = String(rating || '').trim().toLowerCase();
  return clean === 'pg13' || clean === 'r';
}

module.exports = {
  getSettings,
  get: getSettings,  // blueprint: one getter everywhere — const settings = serverSettings.get(guildId) || {}
  saveSettings,
  setAudienceRating,
  setToneProfile,
  getToneSummary,
  getEffectiveToneProfile,
  setBotIdentity,
  resetInstallationDefaults,
  getAllowedTonesForAudience,
  TONE_OPTIONS,
  DEFAULTS,
  setBotStatus,
  getAudienceWarning,
  requiresAgeWarning,
};
