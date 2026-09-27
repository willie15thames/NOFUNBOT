'use strict';

// A readable, unique membership role for every private league or event.
// The role grants no server-wide permissions; its category overwrites grant
// access, and mentionable lets staff tag that space by role.
function membershipRoleName(kind, name, id) {
  const label = kind === 'event' ? 'Event' : 'League';
  const clean = String(name || label).replace(/[\r\n<>@]/g, ' ').replace(/\s+/g, ' ').trim();
  const suffix = String(id || '').slice(0, 8);
  return `${label} • ${clean.slice(0, 84)} • ${suffix}`.slice(0, 100);
}

function membershipRoleOptions(kind, name, id) {
  return {
    name: membershipRoleName(kind, name, id),
    mentionable: true,
    permissions: [],
    reason: `Private ${kind === 'event' ? 'event' : 'league'} membership and tagging`,
  };
}

module.exports = { membershipRoleName, membershipRoleOptions };
