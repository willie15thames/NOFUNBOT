/*
 * NAVIGATION HEADER
 * FILE: src/services/templateThemeService.js
 * LAYER: Service layer
 * PURPOSE: Controls theme presets, experience styling, or UX presentation behavior.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const path = require('path');

const BASE_THEMES = {
  gaming:       { name: 'Arcade Night',       palette: ['#5865F2', '#1F2333', '#A7B1FF'], motif: 'soft neon panels and controller-room contrast' },
  sports:       { name: 'Arena Lights',       palette: ['#2D5BFF', '#101726', '#D7E3FF'], motif: 'scoreboard blues and polished-court contrast' },
  educational:  { name: 'Notebook Glow',      palette: ['#4C7D5B', '#162019', '#D9F0E1'], motif: 'library greens and calm study contrast' },
  professional: { name: 'Boardroom Clean',    palette: ['#3B4252', '#111827', '#DDE6F6'], motif: 'clean slate neutrals and crisp accents' },
  fandom:       { name: 'Lore Shelf',         palette: ['#7C4DFF', '#191429', '#E7DBFF'], motif: 'collector-shelf purples and soft spotlight contrast' },
  support:      { name: 'Safe Harbor',        palette: ['#3D7A7A', '#132020', '#D8F4F4'], motif: 'calm teal gradients and easy reading contrast' },
  social:       { name: 'Late Night Lounge',  palette: ['#6B5B95', '#171422', '#EEE7FF'], motif: 'plush lounge purples and low-glare contrast' },
  music:        { name: 'Studio Wave',        palette: ['#D9485F', '#22131A', '#FFE1E6'], motif: 'soft stage crimson and velvet contrast' },
  events:       { name: 'Spotlight Board',    palette: ['#F59E0B', '#22190D', '#FFF1CC'], motif: 'warm marquee gold and readable event contrast' },
  watchparty:   { name: 'Cinema Fade',        palette: ['#5B6CFF', '#151828', '#DFE4FF'], motif: 'projector blues and theater-dark contrast' },
};

const SUBTHEME_OVERRIDES = {
  // Gaming subtemplates
  nba:           { name: 'Basketball Court',  palette: ['#E1782D', '#2A1A0D', '#FFE7CF'], motif: 'hardwood maple, painted lines, and scoreboard accents' },
  sportsgaming:  { name: 'Franchise Night',   palette: ['#0E7490', '#0F172A', '#D9F7FF'], motif: 'league desk blues and clean stats contrast' },
  cod:           { name: 'Ops Board',         palette: ['#64748B', '#111827', '#E5ECF5'], motif: 'tactical slate panels and muted mission-board contrast' },
  gta:           { name: 'Neon Boulevard',    palette: ['#EC4899', '#1F1020', '#FFE0F1'], motif: 'Vice neon with low-glare dark contrast' },
  // Sports subtemplates
  nfl:           { name: 'NFL Sunday Hub',    palette: ['#1D4ED8', '#0D1117', '#DBEAFE'], motif: 'game day blues, end zone energy, and clean scoreboard contrast' },
  soccer:        { name: 'Pitch Side',        palette: ['#16A34A', '#081A10', '#DCFCE7'], motif: 'match-day greens and pitch-side contrast' },
  // Fandom subtemplates
  marvel:        { name: 'Marvel Spotlight',  palette: ['#E23636', '#190F12', '#FFE1E1'], motif: 'clean red logo energy with readable comic-panel contrast' },
  starwars:      { name: 'Galactic Holo',     palette: ['#3B82F6', '#0A1020', '#DCEBFF'], motif: 'holo-blue glow and starfield contrast' },
  disney:        { name: 'Castle Glow',       palette: ['#7C6BFF', '#16142A', '#EEE9FF'], motif: 'storybook indigo and soft magical contrast' },
  anime:         { name: 'Cel Shade',         palette: ['#FF5CA8', '#201225', '#FFE4F1'], motif: 'bright cel-color accents with soft contrast' },
  // Educational subtemplates
  cybersecurity: { name: 'SOC Screen',        palette: ['#16A34A', '#09140D', '#DCFCE7'], motif: 'terminal green glow with easy-on-eyes dark panels' },
  coding:        { name: 'Debug Terminal',    palette: ['#22D3EE', '#0A1520', '#CFFAFE'], motif: 'cyan terminal glow and dark IDE contrast' },
  language:      { name: 'Notebook Glow',     palette: ['#4C7D5B', '#162019', '#D9F0E1'], motif: 'library greens and calm study contrast' },
  // Watch party / movie subtemplates
  movies:        { name: 'Cinema Reel',       palette: ['#8B5CF6', '#181422', '#EDE9FE'], motif: 'projector violet and theater-seat contrast' },
  wrestling:     { name: 'Arena Lights',      palette: ['#2D5BFF', '#101726', '#D7E3FF'], motif: 'scoreboard blues and polished-court contrast' },
  // Social / other
  watchparty:    { name: 'Cinema Fade',       palette: ['#5B6CFF', '#151828', '#DFE4FF'], motif: 'projector blues and theater-dark contrast' },
  events:        { name: 'Spotlight Board',   palette: ['#F59E0B', '#22190D', '#FFF1CC'], motif: 'warm marquee gold and readable event contrast' },
  music:         { name: 'Studio Wave',       palette: ['#D9485F', '#22131A', '#FFE1E6'], motif: 'soft stage crimson and velvet contrast' },
};

function _hexToInt(hex) {
  try { return parseInt(String(hex || '5865F2').replace(/^#/, ''), 16) || 0x5865F2; }
  catch { return 0x5865F2; }
}

function _slug(v = '') {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const THEME_BANNERS = {
  'arcade-night':      'arcade-night.png',
  'basketball-court':  'basketball-court.png',
  'marvel-spotlight':  'marvel-spotlight.png',
  'ops-board':         'ops-board.png',
  'cinema-reel':       'cinema-reel.png',
  'soc-screen':        'soc-screen.png',
  'boardroom-clean':   'boardroom-clean.png',
  'clean-midnight':    'clean-midnight.png',
  'safe-harbor':       'safe-harbor.png',
  'galactic-holo':     'galactic-holo.png',
  'cel-shade':         'cel-shade.png',
  'neon-boulevard':    'neon-boulevard.png',
  // V101 — full subtemplate coverage
  'arena-lights':      'arena-lights.png',
  'notebook-glow':     'notebook-glow.png',
  'lore-shelf':        'lore-shelf.png',
  'late-night-lounge': 'late-night-lounge.png',
  'studio-wave':       'studio-wave.png',
  'spotlight-board':   'spotlight-board.png',
  'cinema-fade':       'cinema-fade.png',
  'franchise-night':   'franchise-night.png',
  'castle-glow':       'castle-glow.png',
  'nfl-sunday-hub':    'nfl-sunday.png',
  'nba-nightly-run':   'basketball-court.png',
  'debug-terminal':    'soc-screen.png',
  'pitch-side':        'arena-lights.png',
};

function getThemePreset(settings = {}) {
  const baseKey = _slug(settings.serverTemplate || '');
  const subKey = _slug(settings.serverSubtemplate || '');
  const base = BASE_THEMES[baseKey] || { name: 'Clean Midnight', palette: ['#5865F2', '#151823', '#E8ECFF'], motif: 'clean midnight panels and readable accent contrast' };
  const sub = SUBTHEME_OVERRIDES[subKey] || null;
  const appliedName = sub?.name || base.name;
  const palette = sub?.palette || base.palette;
  const motif = sub?.motif || base.motif;
  const bannerKey = _slug(appliedName);
  const bannerFile = THEME_BANNERS[bannerKey] || THEME_BANNERS[_slug(base.name)] || 'clean-midnight.png';
  return {
    baseTheme: base,
    subTheme: sub,
    appliedName,
    palette,
    motif,
    preview: `${appliedName} • ${motif} • ${(palette || []).join(' / ')}`,
    bannerFile,
    bannerPath: path.join(__dirname, '..', '..', 'assets', 'theme-banners', bannerFile),
    accentColor: _hexToInt(palette?.[0]) || 0x5865F2,
    panelColor: palette?.[1] || '#151823',
    textColor: palette?.[2] || '#E8ECFF',
  };
}

module.exports = { getThemePreset, THEME_BANNERS };
