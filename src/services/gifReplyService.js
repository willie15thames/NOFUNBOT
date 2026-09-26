/*
 * NAVIGATION HEADER
 * FILE: src/services/gifReplyService.js
 * LAYER: Service layer
 * PURPOSE: Handles outbound or inbound messaging behavior and response control.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const BANK = {
  hype: [
    'https://media.giphy.com/media/3o7btPCcdNniyf0ArS/giphy.gif',
    'https://media.giphy.com/media/l0HU7JI1m1iU4lB6w/giphy.gif',
  ],
  roast: [
    'https://media.giphy.com/media/8v6Z3YyULB5Q0Skbac/giphy.gif',
    'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif',
  ],
  win: [
    'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif',
    'https://media.giphy.com/media/9zXWAIcr6jycE/giphy.gif',
  ],
  help: [
    'https://media.giphy.com/media/3orieYvhT5EVfSFyBa/giphy.gif',
    'https://media.giphy.com/media/l2JehQ2GitHGdVG9y/giphy.gif',
  ],
};

function _pick(list, seed = Date.now()) {
  if (!Array.isArray(list) || !list.length) return null;
  return list[Math.abs(Number(seed) || 0) % list.length];
}

function chooseCategory(question = '', lane = 'casual') {
  const q = String(question || '').toLowerCase();
  if (/help|how|what do i do|show me|walk me|guide|explain/.test(q)) return 'help';
  if (/won|winner|champ|victory|lets go|hype|fire|cooked|smoked/.test(q)) return 'win';
  if (/trash|roast|cook|clown|smoke|you suck|weak|bitch|trash ass/.test(q) || lane === 'casual') return 'roast';
  return 'hype';
}

function shouldSendGif({ question = '', lane = 'casual', settings = {}, force = false } = {}) {
  if (!settings.allowGifReplies) return false;
  if (force) return true;
  const q = String(question || '').toLowerCase();
  if (/\bgif\b|meme|reaction image|reaction gif/.test(q)) return true;
  if (lane === 'casual' && /trash|roast|cook|hype|lets go|smoked/.test(q)) return true;
  return false;
}

function buildGifReply({ question = '', lane = 'casual', settings = {}, seed = Date.now(), force = false } = {}) {
  if (!shouldSendGif({ question, lane, settings, force })) return null;
  const category = chooseCategory(question, lane);
  return _pick(BANK[category], seed) || _pick(BANK.help, seed);
}

module.exports = {
  BANK,
  chooseCategory,
  shouldSendGif,
  buildGifReply,
};
