'use strict';

const { COMM_ROLE, COMMISSIONER_IDS, IT_ROLE, IT_IDS } = require('../config/env');
const stateStore = require('../state');

function commissionerIds() {
  return new Set([...(COMMISSIONER_IDS || []), ...((stateStore?.commissionerIds && [...stateStore.commissionerIds]) || [])].map(String));
}

function isCommissionerAiAuthorized(member, userId) {
  const uid = String(userId || member?.id || '');
  const hasCommRole = !!(COMM_ROLE && member?.roles?.cache?.has(COMM_ROLE));
  const hasITRole = !!(IT_ROLE && member?.roles?.cache?.has(IT_ROLE));
  return hasCommRole || commissionerIds().has(uid) || hasITRole || !!(IT_IDS && IT_IDS.has(uid));
}

module.exports = { isCommissionerAiAuthorized, commissionerIds };
