'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const router = fs.readFileSync(path.join(__dirname, '../src/routing/interactionRouter.js'), 'utf8');
const reset = fs.readFileSync(path.join(__dirname, '../src/services/cleanSlateResetService.js'), 'utf8');

assert.match(router, /listOperationalLeagues\(\{ guildId:interaction\.guild\.id \}\)/, 'cross-guild fallback is forbidden');
const claim = router.split("case 'claim-attr-boost': {")[1].split("case 'warn-player': {")[0];
assert.match(claim, /requestAttribute/);
assert.match(claim, /pending\. No points were spent/);
assert.doesNotMatch(claim, /pendingAttrBoosts\.set|sourceLabel|nextBoostId/, 'self-declared rewards must not mutate state');
const buttons = router.split('  // Legacy boost buttons')[1].split('  // ── Trade buttons ──')[0];
assert.doesNotMatch(buttons, /pendingAttrBoosts\.delete|Boost approved|APPROVED/, 'legacy buttons cannot approve unverified claims');
for (const model of ['progressionClaim','progressionGrant','entitlementConsumption','postseasonMatch','postseasonBracket','season','operationFence']) {
  assert.ok(reset.includes(model), `clean slate must clear ${model}`);
}
assert.match(reset, /throw new Error\(`DB reset model unavailable:/, 'missing model must fail closed');
assert.doesNotMatch(reset, /log\.warn\(`DB reset \$\{model\}/, 'database deletion errors must not be suppressed');
console.log('Contract v8 live cutover: 1 passed, 0 failed');
