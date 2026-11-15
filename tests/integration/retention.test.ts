import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/client.js';
import { runRetentionJob, startRetentionScheduler } from '../../src/jobs/retention.job.js';
import { loadConfig } from '../../src/config.js';

describe('Retention jobs for tombstones and audit logs (tests/integration/retention.test.ts)', () => {
  const testId = `retention-${Date.now()}`;
  let businessId: string;
  let platformId: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `${testId}@example.com`,
        fullName: 'Retention Tester',
      },
    });
    userId = user.id;

    const platform = await prisma.platform.create({
      data: {
        name: 'Retention Test Platform',
        ownerUserId: userId,
      },
    });
    platformId = platform.id;

    const biz = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: `cust-${testId}`,
        userId,
        businessName: 'Retention Biz',
        ownerName: 'Owner',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
      },
    });
    businessId = biz.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { businessId } });
    await prisma.externalTombstone.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('deletes tombstones past the 180-day retention window while preserving those inside it', async () => {
    const now = new Date('2026-11-15T12:00:00.000Z');
    const pastWindowDate = new Date(now.getTime() - 181 * 86_400_000); // 181 days old -> expired
    const insideWindowDate = new Date(now.getTime() - 179 * 86_400_000); // 179 days old -> keep
    const freshDate = new Date(now.getTime() - 1 * 86_400_000); // 1 day old -> keep

    // Seed tombstones
    const expiredTomb = await prisma.externalTombstone.create({
      data: {
        businessId,
        entityType: 'sale',
        entityId: `sale-expired-${testId}`,
        createdAt: pastWindowDate,
      },
    });

    const activeTomb1 = await prisma.externalTombstone.create({
      data: {
        businessId,
        entityType: 'sale',
        entityId: `sale-active-1-${testId}`,
        createdAt: insideWindowDate,
      },
    });

    const activeTomb2 = await prisma.externalTombstone.create({
      data: {
        businessId,
        entityType: 'invoice',
        entityId: `inv-active-2-${testId}`,
        createdAt: freshDate,
      },
    });

    // Run retention job with clock pinned to `now`
    const result = await runRetentionJob({
      tombstoneRetentionDays: 180,
      now,
    });

    expect(result.deletedTombstones).toBeGreaterThanOrEqual(1);

    // Verify expired tombstone was deleted
    const checkExpired = await prisma.externalTombstone.findUnique({
      where: { id: expiredTomb.id },
    });
    expect(checkExpired).toBeNull();

    // Verify active tombstones are preserved
    const checkActive1 = await prisma.externalTombstone.findUnique({
      where: { id: activeTomb1.id },
    });
    expect(checkActive1).not.toBeNull();

    const checkActive2 = await prisma.externalTombstone.findUnique({
      where: { id: activeTomb2.id },
    });
    expect(checkActive2).not.toBeNull();
  });

  it('deletes audit logs past the 730-day retention window while preserving those inside it', async () => {
    const now = new Date('2026-11-15T12:00:00.000Z');
    const past730Days = new Date(now.getTime() - 731 * 86_400_000); // 731 days old -> expired
    const inside730Days = new Date(now.getTime() - 720 * 86_400_000); // 720 days old -> keep

    const expiredLog = await prisma.auditLog.create({
      data: {
        platformId,
        businessId,
        actor: 'device',
        action: 'device.activated',
        resourceType: 'device',
        resourceId: `dev-expired-${testId}`,
        createdAt: past730Days,
      },
    });

    const activeLog = await prisma.auditLog.create({
      data: {
        platformId,
        businessId,
        actor: 'device',
        action: 'device.activated',
        resourceType: 'device',
        resourceId: `dev-active-${testId}`,
        createdAt: inside730Days,
      },
    });

    const result = await runRetentionJob({
      auditRetentionDays: 730,
      now,
    });

    expect(result.deletedAuditLogs).toBeGreaterThanOrEqual(1);

    const checkExpired = await prisma.auditLog.findUnique({
      where: { id: expiredLog.id },
    });
    expect(checkExpired).toBeNull();

    const checkActive = await prisma.auditLog.findUnique({
      where: { id: activeLog.id },
    });
    expect(checkActive).not.toBeNull();
  });

  it('startRetentionScheduler starts periodic timer and cleans up handle on stop', async () => {
    const config = loadConfig({
      DATABASE_URL: process.env['DATABASE_URL']!,
      NODE_ENV: 'test',
    });

    const handle = startRetentionScheduler(config, 60_000);
    expect(handle).toBeDefined();
    expect(typeof handle.stop).toBe('function');
    expect(typeof handle.triggerNow).toBe('function');

    // triggerNow runs without throwing
    const res = await handle.triggerNow();
    expect(res).toBeDefined();
    expect(res.deletedTombstones).toBeGreaterThanOrEqual(0);

    handle.stop();
  });
});
