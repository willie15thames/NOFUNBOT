/*
 * NAVIGATION HEADER
 * FILE: src/providers/nba2k/index.js
 * LAYER: Provider adapter layer (V202, spec §27)
 * PURPOSE: NBA 2K providers. Today: a generic companion/endpoint data provider (MYBOT_NBA2K_SYNC_URL). No MyNBA
 *          franchise-control capability is assumed — control flags are false until a documented interface exists.
 */

'use strict';

const { createEndpointProvider } = require('../customEndpoint');

module.exports = [
  createEndpointProvider({ key: 'nba2k_companion', label: 'NBA 2K companion / league endpoint (data only)', envUrl: 'MYBOT_NBA2K_SYNC_URL', envToken: 'MYBOT_NBA2K_SYNC_TOKEN' }),
];
