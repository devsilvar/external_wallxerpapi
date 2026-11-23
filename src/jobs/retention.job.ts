import type { Config } from '../config.js';
import { purgeAuditLogsBefore, purgeTombstonesBefore } from '../db/retention.repo.js';
import { purgeApiUsageBefore } from '../db/usage.repo.js';
import { logger } from '../lib/logger.js';

export interface RetentionRunResult {
  deletedTombstones: number;
  deletedAuditLogs: number;
deletedApiUsage: number;
  tombstoneCutoff: Date;
  auditCutoff: Date;
usageCutoff: Date;
}

/**
 * Runs the retention purge for tombstones and audit logs.
 * Accepts an injected clock (`now`) and days for deterministic testability.
 */
export async function runRetentionJob(options?: {
  tombstoneRetentionDays?: number;
  auditRetentionDays?: number;
  usageRetentionDays?: number;
now?: Date;
}): Promise<RetentionRunResult> {
  const now = options?.now ?? new Date();

  const tombstoneDays = options?.tombstoneRetentionDays ?? 180;
  const auditDays = options?.auditRetentionDays ?? 730;
const usageDays = options?.usageRetentionDays ?? 400;

  const tombstoneCutoff = new Date(now.getTime() - tombstoneDays * 86_400_000);
  const auditCutoff = new Date(now.getTime() - auditDays * 86_400_000);
const usageCutoff = new Date(now.getTime() - usageDays * 86_400_000);

  // 1. Purge tombstones past retention window
  const tombstoneResult = await purgeTombstonesBefore(tombstoneCutoff);

  // 2. Purge audit logs past retention window
  const auditResult = await purgeAuditLogsBefore(auditCutoff);

// 3. Purge API usage rollups past retention window
const usageResult = await purgeApiUsageBefore(usageCutoff);

  logger.info(
    {
      deletedTombstones: tombstoneResult.count,
      deletedAuditLogs: auditResult.count,
deletedApiUsage: usageResult.count,
      tombstoneCutoff: tombstoneCutoff.toISOString(),
      auditCutoff: auditCutoff.toISOString(),
usageCutoff: usageCutoff.toISOString(),
    },
    'Retention purge completed'
  );

  return {
    deletedTombstones: tombstoneResult.count,
    deletedAuditLogs: auditResult.count,
deletedApiUsage: usageResult.count,
    tombstoneCutoff,
    auditCutoff,
usageCutoff,
  };
}

export interface RetentionSchedulerHandle {
  stop: () => void;
  triggerNow: () => Promise<RetentionRunResult>;
}

/**
 * Schedules periodic execution of the retention job.
 */
export function startRetentionScheduler(
  config: Config,
  intervalMs = 24 * 60 * 60 * 1000
): RetentionSchedulerHandle {
  const run = async () => {
    try {
      return await runRetentionJob({
        tombstoneRetentionDays: config.EXTERNAL_TOMBSTONE_RETENTION_DAYS,
        auditRetentionDays: config.EXTERNAL_AUDIT_RETENTION_DAYS,
usageRetentionDays: config.EXTERNAL_USAGE_RETENTION_DAYS,
      });
    } catch (err) {
      logger.error({ err }, 'Error executing retention scheduled job');
      throw err;
    }
  };

  const timer = setInterval(() => {
    void run();
  }, intervalMs);

  timer.unref();

  return {
    stop: () => clearInterval(timer),
    triggerNow: run,
  };
}
