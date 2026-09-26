/*
 * NAVIGATION HEADER
 * FILE: src/services/serverTemplateLogicService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { TEMPLATE_REGISTRY, getTemplate, resolveTemplateProfile } = require('./templateRegistryService');

const UNSET_PROFILE = {
  key: '',
  name: 'Not selected yet',
  summary: 'Choose a server template to unlock the right categories, channels, rules, and guide flow for this server type.',
  leagueFriendly: false,
  subservers: [],
  guideBullets: [
    'Pick a server template before build so the server channels and rules match the actual purpose of the community.',
    'Gaming, sports, educational, movie, professional, and other templates do not share identical logic.',
    'Custom structure can still remix channels, but the template should be chosen first.'
  ],
  joinHelp: 'No template has been selected yet.',
  aiHints: ['No server template selected yet. Ask staff to finish the setup wizard.'],
  quickAnswers: {},
  categories: [],
};

function getTemplateKey(settings = {}) {
  const raw = String(settings.serverTemplate || '').trim().toLowerCase();
  return TEMPLATE_REGISTRY[raw] ? raw : '';
}

function getTemplateProfile(settings = {}) {
  const key = getTemplateKey(settings);
  return key ? resolveTemplateProfile(settings) : UNSET_PROFILE;
}

function buildBaseGuideText(settings = {}) {
  const profile = getTemplateProfile(settings);
  return `This channel explains the server. Template: **${profile.name}**.\n\n• ${profile.guideBullets.join('\n• ')}\n• Use \`/manual\` for a guide based on **your** role.`;
}

function getGuideChannelName(settings = {}) {
  // Returns the right guide channel name for the template
  // This must match the channel name created in initializeBaseStructure
  const profile = getTemplateProfile(settings);
  // V188: All templates use server-guide — "league" is a feature, not the default
  return 'server-guide';
}

function buildWelcomeText(serverName, settings = {}) {
  const profile = getTemplateProfile(settings);
  const guideName = getGuideChannelName(settings);
  const guideLabel = 'server-guide';
  const purposeText = profile.leagueFriendly
    ? `the ${profile.name.toLowerCase()} layout and active communities`
    : `how ${profile.name.toLowerCase()} is structured`;
  return `This is the home base for **${serverName}**.\n\n• Read **#rules** for server rules and conduct\n• Read **#${guideLabel}** for ${purposeText}\n• Read **#how-to-join** to get to the right place\n\nCurrent template: **${profile.name}**.`;
}

function buildHowToJoinText(settings = {}, hasLeague = false) {
  const profile = getTemplateProfile(settings);
  if ((profile.leagueFriendly || hasLeague) && hasLeague) {
    // League actually exists — show league flow
    return `1. Use the league intake flow when staff opens a league\n2. Pick an active league\n3. Pick an open team or the custom-team path if the league supports it\n4. Save your timezone so scheduling makes sense\n\n${profile.joinHelp}`;
  }
  if (profile.leagueFriendly && !hasLeague) {
    // League-friendly template but no league yet
    return `This is a **${profile.name}** server.\n\n${profile.joinHelp}\n\nLeague and team features will open when staff creates one with \`/setup-league\`.`;
  }
  // Non-league template — no mention of leagues at all
  return `This is a **${profile.name}** server.\n\n${profile.joinHelp}`;
}

function getConversationHints(settings = {}) {
  const templateHints = getTemplateProfile(settings).aiHints || [];
  // Merge community pack hints (adds family + niche context)
  try {
    const packHints = require('./communityPackService').resolveAIHints(settings);
    const merged = [...packHints, ...templateHints.filter(h => !packHints.includes(h))];
    return merged;
  } catch {
    return templateHints;
  }
}

function getQuickAnswer(key, settings = {}) {
  const profile = getTemplateProfile(settings);
  return profile.quickAnswers?.[key] || null;
}

function getGuideChannelTopic(settings = {}) {
  // V192: Data-driven — derives topic from template profile instead of hardcoded if/else per template
  const profile = getTemplateProfile(settings);
  if (profile?.summary) return `${profile.name} server guide — ${profile.summary}`;
  return `${profile?.name || 'Server'} guide and community navigation.`;
}

module.exports = {
  TEMPLATE_PROFILES: TEMPLATE_REGISTRY,
  getTemplateKey,
  getTemplateProfile,
  getGuideChannelName,
  getGuideChannelTopic,
  buildBaseGuideText,
  buildWelcomeText,
  buildHowToJoinText,
  getConversationHints,
  getQuickAnswer,
};
