import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { createCustomer, createSale } from '../../src/db/scoped.js';
import { generateApiKey, hashToken } from '../../src/lib/token.js';

describe('Sync, keyset paging, and tombstones (tests/integration/sync.test.ts)', () => {
  const testId = `sync-${Date.now()}`;
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
  });
  const app = createApp(config);

  let platformId: string;
  let userId: string;
  let businessId: string;
  let apiKey: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `${testId}@example.com`,
        fullName: 'Sync Tester',
      },
    });
    userId = user.id;

    apiKey = generateApiKey('sk_ext_live_');
    const platform = await prisma.platform.create({
      data: {
        name: 'Sync Test Platform',
        ownerUserId: userId,
        apiKeyHash: hashToken(apiKey),
        apiKeyPrefix: apiKey.slice(0, 16),
      },
    });
    platformId = platform.id;

    const biz = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: `cust-${testId}`,
        userId,
        businessName: 'Sync Biz',
        ownerName: 'Owner',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
      },
    });
    businessId = biz.id;
  });

  afterAll(async () => {
    await prisma.externalTombstone.deleteMany({ where: { businessId } });
    await prisma.saleLineItem.deleteMany({ where: { sale: { businessId } } });
    await prisma.salesTransaction.deleteMany({ where: { businessId } });
    await prisma.customer.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('paginates over a batch of 50 sales sharing one updatedAt and returns each row exactly once', async () => {
    const baseDate = new Date('2026-11-10T10:00:00.000Z');
    // Pre-create 50 sales with the exact same updatedAt
    const salesData = Array.from({ length: 50 }, (_, i) => ({
      referenceId: `batch-sale-${testId}-${String(i).padStart(3, '0')}`,
      amount: '1000.00',
      source: 'api' as const,
      transactionDate: new Date('2026-11-10'),
    }));

    for (const item of salesData) {
      await createSale(businessId, item);
    }

    // Force all 50 sales to share the exact same updatedAt
    await prisma.salesTransaction.updateMany({
      where: {
        businessId,
        referenceId: { startsWith: `batch-sale-${testId}-` },
      },
      data: {
        updatedAt: baseDate,
      },
    });

    // Page through via GET /sales with limit 20 and updatedSince (sync mode)
    const seenIds = new Set<string>();
    let cursor: string | null = null;
    let pagesFetched = 0;

    do {
      pagesFetched++;
      let url = `/api/external/v1/accounts/${businessId}/sales?limit=20&updatedSince=2026-11-10T09:00:00.000Z`;
      if (cursor) {
        url += `&cursor=${encodeURIComponent(cursor)}`;
      }

      const res = await request(app)
        .get(url)
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(200);
      const items = res.body.data;

      for (const item of items) {
        if (item.referenceId.startsWith(`batch-sale-${testId}-`)) {
          expect(seenIds.has(item.id)).toBe(false); // No duplicates
          seenIds.add(item.id);
        }
      }

      cursor = res.body.page.nextCursor;
    } while (cursor !== null && pagesFetched < 5);

    expect(seenIds.size).toBe(50);
  });

  it('proves customer soft delete writes tombstone and re-creation reactivates rather than duplicating', async () => {
    const extId = `reactivate-cust-${testId}`;

    // 1. Create customer
    const createRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/customers`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalId: extId,
        name: 'Temporary Customer',
      });

    expect(createRes.status).toBe(201);
    const customerId = createRes.body.data.id;

    // 2. Soft delete customer
    const delRes = await request(app)
      .delete(`/api/external/v1/accounts/${businessId}/customers/${customerId}`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(delRes.status).toBe(200);

    // Assert soft-deleted in DB
    const dbCust = await prisma.customer.findUnique({ where: { id: customerId } });
    expect(dbCust!.isActive).toBe(false);

    // Assert tombstone in deletions endpoint
    const tombRes = await request(app)
      .get(`/api/external/v1/accounts/${businessId}/deletions`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(tombRes.status).toBe(200);
    const tombstoneFound = tombRes.body.data.some(
      (t: { entityId: string; entityType: string }) =>
        t.entityId === customerId && t.entityType === 'customer'
    );
    expect(tombstoneFound).toBe(true);

    // 3. Re-create customer with the SAME externalId -> 200 OK with reactivated row
    const recreateRes = await request(app)
      .post(`/api/external/v1/accounts/${businessId}/customers`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalId: extId,
        name: 'Reactivated Customer Name',
      });

    expect(recreateRes.status).toBe(201); // or 200
    expect(recreateRes.body.data.id).toBe(customerId); // Same row ID
    expect(recreateRes.body.data.isActive).toBe(true);
    expect(recreateRes.body.data.name).toBe('Reactivated Customer Name');
  });

  it('proves customer edits appear in ?updatedSince queries', async () => {
    const extId = `edit-sync-${testId}`;
    const cust = await createCustomer(businessId, {
      externalId: extId,
      name: 'Before Edit',
    });

    const beforeTime = new Date();

    // Small delay to ensure timestamp separation
    await new Promise((r) => setTimeout(r, 200));

    // Edit customer
    await request(app)
      .patch(`/api/external/v1/accounts/${businessId}/customers/${cust.id}`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        name: 'After Edit',
      });

    // Query with updatedSince = beforeTime
    const syncRes = await request(app)
      .get(
        `/api/external/v1/accounts/${businessId}/customers?updatedSince=${encodeURIComponent(
          beforeTime.toISOString()
        )}`
      )
      .set('Authorization', `Bearer ${apiKey}`);

    expect(syncRes.status).toBe(200);
    const found = syncRes.body.data.find((c: { id: string }) => c.id === cust.id);
    expect(found).toBeDefined();
    expect(found.name).toBe('After Edit');
  });

  it('P6-01: paginates over deletions with cursor and limit, returning each deleted row exactly once', async () => {
    const baseCreatedAt = new Date('2026-11-12T12:00:00.000Z');

    // Create 15 tombstones directly for this business with same or staggered createdAt
    await prisma.externalTombstone.createMany({
      data: Array.from({ length: 15 }, (_, i) => ({
        businessId,
        entityType: 'expense',
        entityId: `exp-deleted-${testId}-${i}`,
        createdAt: new Date(baseCreatedAt.getTime() + i * 1000),
      })),
    });

    const seenIds = new Set<string>();
    let cursor: string | null = null;
    let pageCount = 0;

    do {
      pageCount++;
      let url = `/api/external/v1/accounts/${businessId}/deletions?limit=5`;
      if (cursor) {
        url += `&cursor=${encodeURIComponent(cursor)}`;
      }

      const res = await request(app)
        .get(url)
        .set('Authorization', `Bearer ${apiKey}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.page).toBeDefined();

      for (const t of res.body.data) {
        if (t.entityId.startsWith(`exp-deleted-${testId}-`)) {
          expect(seenIds.has(t.id)).toBe(false); // No duplicates!
          seenIds.add(t.id);
        }
      }

      cursor = res.body.page.nextCursor;
      if (cursor !== null) {
        expect(res.body.page.hasMore).toBe(true);
      } else {
        expect(res.body.page.hasMore).toBe(false);
      }
    } while (cursor !== null && pageCount < 10);

    expect(seenIds.size).toBe(15);
    expect(pageCount).toBeGreaterThanOrEqual(3);
  });
});
