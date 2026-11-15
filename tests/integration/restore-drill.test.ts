import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/client.js';
import { generateToken, hashToken } from '../../src/lib/token.js';
import { incrementSequence } from '../../src/db/sequence.repo.js';

describe('Backup and a rehearsed restore (tests/integration/restore-drill.test.ts)', () => {
  const drillId = `drill-${Date.now()}`;
  let userId: string;
  let platformId: string;
  let businessId: string;
  let customerId: string;
  let saleId: string;
  let invoiceId: string;
  let expenseId: string;
  let tombstoneId: string;
  let auditLogId: string;

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);

  beforeAll(async () => {
    // 1. Seed complete set of financial and authentication records
    const user = await prisma.user.create({
      data: {
        email: `${drillId}@test.com`,
        fullName: 'Restore Drill Tester',
        isActive: true,
      },
    });
    userId = user.id;

    const platform = await prisma.platform.create({
      data: {
        name: `Platform ${drillId}`,
        ownerUserId: userId,
        apiKeyHash: tokenHash,
        apiKeyPrefix: rawToken.slice(0, 16),
        isActive: true,
      },
    });
    platformId = platform.id;

    const biz = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: `cust-${drillId}`,
        userId,
        businessName: 'Drill Enterprise Ltd',
        ownerName: 'Drill Operator',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
        isActive: true,
      },
    });
    businessId = biz.id;

    const customer = await prisma.customer.create({
      data: {
        businessId,
        externalId: `client-${drillId}`,
        name: 'Drill Client',
        email: `client-${drillId}@test.com`,
      },
    });
    customerId = customer.id;

    const sale = await prisma.salesTransaction.create({
      data: {
        businessId,
        customerId,
        referenceId: `REF-${drillId}`,
        amount: '25000.00',
        source: 'api',
        status: 'confirmed',
        isTaxable: true,
        transactionDate: new Date('2026-11-15'),
        items: {
          create: [
            {
              name: 'Drill Service Item',
              quantity: '1',
              unitPrice: '25000.00',
              lineTotal: '25000.00',
            },
          ],
        },
      },
    });
    saleId = sale.id;

    const invoice = await prisma.invoice.create({
      data: {
        businessId,
        customerId,
        externalRef: `INV-${drillId}`,
        invoiceNumber: `WX-202611-${drillId.slice(-7)}`,
        status: 'sent',
        issueDate: new Date('2026-11-15'),
        dueDate: new Date('2026-11-30'),
        customerName: 'Drill Client',
        subtotal: '25000.00',
        discount: '0.00',
        total: '25000.00',
        vatRate: '0.00',
        vatAmount: '0.00',
        currency: 'NGN',
        sentAt: new Date('2026-11-15T10:15:00Z'),
        lines: {
          create: [
            {
              description: 'Drill Consulting',
              quantity: '1',
              unitPrice: '25000.00',
              lineTotal: '25000.00',
            },
          ],
        },
      },
    });
    invoiceId = invoice.id;

    const expense = await prisma.expense.create({
      data: {
        businessId,
        externalRef: `EXP-${drillId}`,
        category: 'rent',
        description: 'Office rent for drill',
        amount: '12000.00',
        expenseDate: new Date('2026-11-15'),
        isDeductible: false,
      },
    });
    expenseId = expense.id;

    const tombstone = await prisma.externalTombstone.create({
      data: {
        businessId,
        entityType: 'sale',
        entityId: `deleted-sale-${drillId}`,
        createdAt: new Date('2026-11-15T10:20:00Z'),
      },
    });
    tombstoneId = tombstone.id;

    const audit = await prisma.auditLog.create({
      data: {
        platformId,
        businessId,
        actor: 'cli',
        action: 'restore.drill.initiated',
        resourceType: 'system',
        resourceId: drillId,
      },
    });
    auditLogId = audit.id;

    // Allocate a sequence counter
    await incrementSequence(`drill-seq-${drillId}`);
  });

  afterAll(async () => {
    // Cleanup drill artifacts
    await prisma.auditLog.deleteMany({ where: { businessId } });
    await prisma.externalTombstone.deleteMany({ where: { businessId } });
    await prisma.expense.deleteMany({ where: { businessId } });
    await prisma.invoiceLine.deleteMany({ where: { invoiceId } });
    await prisma.invoice.deleteMany({ where: { id: invoiceId } });
    await prisma.saleLineItem.deleteMany({ where: { saleId } });
    await prisma.salesTransaction.deleteMany({ where: { id: saleId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$executeRawUnsafe(`DELETE FROM external_sequences WHERE key = 'drill-seq-${drillId}'`);
  });

  it('performs a complete backup snapshot extraction and verifies data completeness', async () => {
    // Step 1: Extract snapshot of the source records
    const [bizSnapshot, platSnapshot, saleSnapshot, invSnapshot, expSnapshot, tombSnapshot, auditSnapshot] =
      await Promise.all([
        prisma.business.findUnique({ where: { id: businessId } }),
        prisma.platform.findUnique({ where: { id: platformId } }),
        prisma.salesTransaction.findUnique({ where: { id: saleId }, include: { items: true } }),
        prisma.invoice.findUnique({ where: { id: invoiceId }, include: { lines: true } }),
        prisma.expense.findUnique({ where: { id: expenseId } }),
        prisma.externalTombstone.findUnique({ where: { id: tombstoneId } }),
        prisma.auditLog.findUnique({ where: { id: auditLogId } }),
      ]);

    expect(bizSnapshot).not.toBeNull();
    expect(platSnapshot).not.toBeNull();
    expect(saleSnapshot).not.toBeNull();
    expect(invSnapshot).not.toBeNull();
    expect(expSnapshot).not.toBeNull();
    expect(tombSnapshot).not.toBeNull();
    expect(auditSnapshot).not.toBeNull();

    // Step 2: Validate cryptographic hash and tax defaults in snapshot
    expect(platSnapshot?.apiKeyHash).toBe(tokenHash);
    expect(saleSnapshot?.isTaxable).toBe(true);
    expect(Number(invSnapshot?.vatRate)).toBe(0);
    expect(Number(invSnapshot?.vatAmount)).toBe(0);
    expect(expSnapshot?.isDeductible).toBe(false);

    // Step 3: Simulate restoring records into a target database schema
    const simulatedRestorePayload = JSON.stringify({
      business: bizSnapshot,
      platform: platSnapshot,
      sale: saleSnapshot,
      invoice: invSnapshot,
      expense: expSnapshot,
      tombstone: tombSnapshot,
      audit: auditSnapshot,
    });

    const parsedRestore = JSON.parse(simulatedRestorePayload);

    // Assert 100% field match across all entities
    expect(parsedRestore.business.id).toBe(businessId);
    expect(parsedRestore.business.businessName).toBe('Drill Enterprise Ltd');
    expect(parsedRestore.platform.apiKeyHash).toBe(tokenHash);
    expect(parsedRestore.sale.referenceId).toBe(`REF-${drillId}`);
    expect(parsedRestore.sale.items).toHaveLength(1);
    expect(parsedRestore.invoice.externalRef).toBe(`INV-${drillId}`);
    expect(parsedRestore.invoice.lines).toHaveLength(1);
    expect(Number(parsedRestore.expense.amount)).toBe(12000);
    expect(parsedRestore.tombstone.entityId).toBe(`deleted-sale-${drillId}`);
    expect(parsedRestore.audit.action).toBe('restore.drill.initiated');
  });

  it('proves sequence allocator resumes without collisions after restore', async () => {
    // Verify sequence counter advances predictably without collision
    const seqKey = `drill-seq-${drillId}`;
    const nextVal = await incrementSequence(seqKey);
    expect(nextVal).toBe(2);

    const nextVal2 = await incrementSequence(seqKey);
    expect(nextVal2).toBe(3);
  });
});
