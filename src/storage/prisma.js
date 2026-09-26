/*
 * NAVIGATION HEADER
 * FILE: src/storage/prisma.js
 * LAYER: Persistence/storage layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Used by persistence code and deployment/bootstrap workflows.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

let prismaInstance = null;
let prismaAvailable = false;

function getPrisma() {
  if (prismaInstance) return prismaInstance;
  if (!process.env.DATABASE_URL) return null;
  try {
    const { PrismaClient } = require('@prisma/client');
    prismaInstance = new PrismaClient({ log: ['error'] });
    prismaAvailable = true;
    return prismaInstance;
  } catch (err) {
    prismaAvailable = false;
    console.warn(`[prisma] unavailable: ${err.message}`);
    return null;
  }
}

async function prismaSafe(fn, fallback = null) {
  const prisma = getPrisma();
  if (!prisma) return fallback;
  try {
    return await fn(prisma);
  } catch (err) {
    console.warn(`[prisma] operation failed: ${err.message}`);
    return fallback;
  }
}

function isPrismaAvailable() {
  return prismaAvailable || !!prismaInstance;
}

module.exports = { getPrisma, prismaSafe, isPrismaAvailable };
