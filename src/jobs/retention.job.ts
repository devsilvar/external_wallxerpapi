import type { Config } from '../config.js';
import { purgeAuditLogsBefore, purgeTombstonesBefore } from '../db/retention.repo.js';
import { logger } from '../lib/logger.js';

export interface RetentionRunResult {
  deletedTombstones: number;
  deletedAuditLogs: number;
  tombstoneCutoff: Date;
  auditCutoff: Date;
}

/**
 * Runs the retention purge for tombstones and audit logs.
 * Accepts an injected clock (`now`) and days for deterministic testability.
 */
export async function runRetentionJob(options?: {
  tombstoneRetentionDays?: number;
  auditRetentionDays?: number;
  now?: Date;
}): Promise<RetentionRunResult> {
  const now = options?.now ?? new Date();

  const tombstoneDays = options?.tombstoneRetentionDays ?? 180;
  const auditDays = options?.auditRetentionDays ?? 730;

  const tombstoneCutoff = new Date(now.getTime() - tombstoneDays * 86_400_000);
  const auditCutoff = new Date(now.getTime() - auditDays * 86_400_000);

  // 1. Purge tombstones past retention window
  const tombstoneResult = await purgeTombstonesBefore(tombstoneCutoff);

  // 2. Purge audit logs past retention window
  const auditResult = await purgeAuditLogsBefore(auditCutoff);

  logger.info(
    {
      deletedTombstones: tombstoneResult.count,
      deletedAuditLogs: auditResult.count,
      tombstoneCutoff: tombstoneCutoff.toISOString(),
      auditCutoff: auditCutoff.toISOString(),
    },
    'Retention purge completed'
  );

  return {
    deletedTombstones: tombstoneResult.count,
    deletedAuditLogs: auditResult.count,
    tombstoneCutoff,
    auditCutoff,
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
