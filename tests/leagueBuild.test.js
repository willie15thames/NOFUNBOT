'use strict';
const { test, run, assert, eq } = require('./_harness');
const { execute, get } = require('../src/league/build/leagueBuildService');

function fixture() {
  const items = new Map();
  const deleted = [];
  const guild = { id: 'build-test', channels: { cache: {
    find: fn => [...items.values()].find(fn), get: id => items.get(id),
  } } };
  function resource(name, type, parentId) {
    const id = `${type}-${name}`;
    const item = { id, name, type, parentId, isTextBased: () => type === 0,
      delete: async () => { deleted.push(id); items.delete(id); } };
    items.set(id, item);
    return item;
  }
  return { guild, items, deleted, resource };
}
const plan = { leagueTypeId: 'madden_franchise', categories: [
  { name: 'League Info', channels: [{ key: 'rules', name: 'no.rules' }, { key: 'general', name: 'no.general' }] },
] };

test('failed channel creation rolls back new resources without committing', async () => {
  const f = fixture();
  let committed = false;
  let buildId;
  try {
    await execute({ guild: f.guild, plan,
      createCategory: () => f.resource('League Info', 4),
      createChannel: channel => channel.key === 'general' ? Promise.reject(new Error('Discord denied')) : f.resource(channel.name, 0, '4-League Info'),
      commit: () => { committed = true; },
    });
  } catch (err) { buildId = err.buildId; }
  assert(buildId, 'failed build ID is exposed');
  eq(get(buildId).state, 'ROLLED_BACK');
  eq(committed, false);
  eq(f.items.size, 0);
  eq(f.deleted.length, 2);
});

test('rerun reuses existing channels and never deletes them on failure', async () => {
  const f = fixture();
  f.resource('League Info', 4);
  f.resource('no.rules', 0, '4-League Info');
  let buildId;
  try {
    await execute({ guild: f.guild, plan,
      createCategory: () => f.items.get('4-League Info'),
      createChannel: () => { throw new Error('Discord denied'); },
      commit: () => { throw new Error('should not commit'); },
    });
  } catch (err) { buildId = err.buildId; }
  assert(buildId, 'failure recorded');
  eq(f.deleted.length, 0);
  eq(f.items.size, 2);
});

test('successful build commits after validation and rerun creates no channels', async () => {
  const f = fixture();
  let commits = 0;
  const options = { guild: f.guild, plan,
    createCategory: () => f.items.get('4-League Info') || f.resource('League Info', 4),
    createChannel: (channel, category) => f.resource(channel.name, 0, category.id),
    commit: () => { commits++; return { activeLeague: { id: 'no-1' } }; },
  };
  const first = await execute(options);
  const second = await execute(options);
  eq(first.createdCount, 2);
  eq(second.createdCount, 0);
  eq(commits, 2);
  eq(get(second.buildId).state, 'COMMITTED');
});

run('leagueBuild.test.js');
