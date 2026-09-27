/*
 * NAVIGATION HEADER
 * FILE: src/queue/queues.js
 * LAYER: Queue/background execution layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: See nearby files in the same folder for related behavior.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';
const { Queue } = require('bullmq');

function getRedisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  return { connection: { url } };
}

function getQueue(name) {
  const redis = getRedisConnection();
  if (!redis) return null;
  return new Queue(name, redis);
}

async function enqueueStorageSync(filename, data) {
  const queue = getQueue('storage-sync');
  if (!queue) return false;
  await queue.add('storage-sync-write', { filename, data }, { removeOnComplete: 250, removeOnFail: 250 });
  return true;
}

module.exports = { getQueue, getRedisConnection, enqueueStorageSync };
