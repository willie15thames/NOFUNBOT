-- Migration: v111 — AuditLog table + security middleware support

CREATE TABLE IF NOT EXISTS "audit_log" (
    "id"        TEXT NOT NULL,
    "action"    TEXT NOT NULL,
    "userId"    TEXT,
    "guildId"   TEXT,
    "targetId"  TEXT,
    "details"   TEXT,
    "severity"  TEXT NOT NULL DEFAULT 'info',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_log_guildId_timestamp_idx" ON "audit_log"("guildId","timestamp");
CREATE INDEX IF NOT EXISTS "audit_log_userId_timestamp_idx"  ON "audit_log"("userId","timestamp");
