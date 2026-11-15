import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/client.js';
import { parseCsv, provisionAccounts, type CsvAccountRow } from '../../src/cli/provision.js';

describe('Provisioning CLI (tests/integration/provisioning.test.ts)', () => {
  const testId = `prov-${Date.now()}`;
  let platformId: string;
  let userId: string;
  let sampleRows: CsvAccountRow[];

  beforeAll(async () => {
    // 1. Create a platform owner user
    const user = await prisma.user.create({
      data: {
        email: `${testId}-owner@example.com`,
        fullName: 'Provisioning Test Platform Owner',
      },
    });
    userId = user.id;

    // 2. Create a platform
    const platform = await prisma.platform.create({
      data: {
        name: 'Wowo Provisioning Test Platform',
        ownerUserId: userId,
      },
    });
    platformId = platform.id;

    // 3. Generate 100-row CSV content
    let csvContent = 'externalCustomerId,businessName,ownerName,phone,email,address,city,state\n';
    for (let i = 1; i <= 100; i++) {
      const pad = String(i).padStart(3, '0');
      csvContent += `CUST-${testId}-${pad},Store ${pad},Owner ${pad},08012345${pad},store${pad}@test.com,Plot ${i} Test Ave,Lagos,Lagos\n`;
    }

    sampleRows = parseCsv(csvContent);
    expect(sampleRows).toHaveLength(100);
  });

  afterAll(async () => {
    // Cleanup created businesses and associated records
    const businesses = await prisma.business.findMany({
      where: { platformId },
      select: { id: true },
    });
    const bizIds = businesses.map((b) => b.id);

    if (bizIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { businessId: { in: bizIds } } });
      await prisma.externalDevice.deleteMany({ where: { businessId: { in: bizIds } } });
      await prisma.businessMember.deleteMany({ where: { businessId: { in: bizIds } } });
      await prisma.business.deleteMany({ where: { id: { in: bizIds } } });
    }

    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it(
    'provisions 100 accounts on first run without emitting any code or credential',
    async () => {
      const run1 = await provisionAccounts(sampleRows, platformId, prisma, 5);

      expect(run1.total).toBe(100);
      expect(run1.created).toBe(100);
      expect(run1.skipped).toBe(0);
      expect(run1.errors).toHaveLength(0);

      // Verify 100 businesses in DB
      const count = await prisma.business.count({ where: { platformId } });
      expect(count).toBe(100);

      // Verify every business has exactly one dormant device with no code and no token
      const devices = await prisma.externalDevice.findMany({ where: { platformId } });
      expect(devices).toHaveLength(100);
      for (const dev of devices) {
        expect(dev.codeHash).toBeNull();
        expect(dev.tokenHash).toBeNull();
        expect(dev.activatedAt).toBeNull();
      }

      // Verify audit logs
      const auditLogs = await prisma.auditLog.findMany({
        where: { platformId, action: 'account.provisioned' },
      });
      expect(auditLogs).toHaveLength(100);
      for (const log of auditLogs) {
        expect(log.actor).toBe('cli');
        expect(log.userId).toBe(userId);
      }
    },
    300_000
  );

  it('running the same 100-row CSV twice yields 0 duplicates and skips all 100', async () => {
    const run2 = await provisionAccounts(sampleRows, platformId, prisma, 5);

    expect(run2.total).toBe(100);
    expect(run2.created).toBe(0);
    expect(run2.skipped).toBe(100);
    expect(run2.errors).toHaveLength(0);

    // Verify still exactly 100 businesses in DB
    const count = await prisma.business.count({ where: { platformId } });
    expect(count).toBe(100);
  });
});
