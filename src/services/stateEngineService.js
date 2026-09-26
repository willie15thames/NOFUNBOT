/*
 * NAVIGATION HEADER
 * FILE: src/services/stateEngineService.js
 * LAYER: Service layer
 * PURPOSE: Owns or coordinates application state and source-of-truth decisions.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const fs = require('fs');
const { getDataFilePath } = require('../storage/jsonStore');

const FILE = getDataFilePath('stateEngine.json');

function readState() {
  try {
    if (!fs.existsSync(FILE)) {
      return { boards: {}, timers: {}, lastHashes: {}, meta: {} };
    }
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    return { boards: {}, timers: {}, lastHashes: {}, meta: { readError: String(err.message || err) } };
  }
}

function writeState(state) {
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2), 'utf8');
  return state;
}

function getBoard(boardKey) {
  const state = readState();
  return state.boards[boardKey] || null;
}

function setBoard(boardKey, value) {
  const state = readState();
  state.boards[boardKey] = { ...(state.boards[boardKey] || {}), ...value, updatedAt: Date.now() };
  writeState(state);
  return state.boards[boardKey];
}

function getHash(boardKey) {
  const state = readState();
  return state.lastHashes[boardKey] || null;
}

function setHash(boardKey, hash) {
  const state = readState();
  state.lastHashes[boardKey] = hash;
  writeState(state);
  return hash;
}

module.exports = {
  readState,
  writeState,
  getBoard,
  setBoard,
  getHash,
  setHash,
};
