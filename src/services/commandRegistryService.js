/*
 * NAVIGATION HEADER
 * FILE: src/services/commandRegistryService.js
 * LAYER: Service layer
 * PURPOSE: Defines slash-command behavior or command dispatch logic.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const { TOKEN, CLIENT_ID, GUILD_ID } = require('../config/env');
const { REST, Routes } = require('discord.js');
const wizardStateService = require('./wizardStateService');
const activeLeagueService = require('./activeLeagueService');
const state = require('../state');
const { buildCommandsForState } = require('../commands');

function getCommandDeploymentState(nextState = state) {
  const wizardState = wizardStateService.getState();
  return {
    installationMode: !!wizardState.installationMode,
    hasActiveLeague: activeLeagueService.listResetOptions(nextState).length > 0,
  };
}

function getCommandsForCurrentState(nextState = state) {
  return buildCommandsForState(getCommandDeploymentState(nextState));
}

async function deployCommandsForCurrentState(nextState = state) {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const body = getCommandsForCurrentState(nextState);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body });
  return { count: body.length, ...getCommandDeploymentState(nextState) };
}

module.exports = {
  getCommandDeploymentState,
  getCommandsForCurrentState,
  deployCommandsForCurrentState,
};
