'use strict';
const assert = require('assert');
const fs = require('fs');
const patch = require('../src/services/patchNotesService');

const text = patch.readPatchText();
assert(text.includes('v1.0.0'), 'public patch notes must contain v1.0.0');
assert(!text.includes('V204.7 RC3'), 'internal RC history must not appear in public patch source');
assert(!text.includes('merge conflict'), 'internal engineering history must not appear in public patch source');
console.log('Public patch notes regression: 3 passed, 0 failed');
