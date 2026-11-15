import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/client.js';

describe('Safe tax defaults (tests/integration/tax-defaults.test.ts)', () => {
  const testId = `tax-test-${Date.now()}`;
  let platformId: string;
  let userId: string;
  let businessId: string;

  beforeAll(async () => {
    // 1. Create a platform owner user
    const user = await prisma.user.create({
      data: {
        email: `${testId}-owner@example.com`,
        fullName: 'Platform Test Owner',
      },
    });
    userId = user.id;

    // 2. Create a platform
    const platform = await prisma.platform.create({
      data: {
        name: 'Test Wowo Platform',
        ownerUserId: userId,
      },
    });
    platformId = platform.id;

    // 3. Create a business
    const business = await prisma.business.create({
      data: {
        platformId,
        externalCustomerId: `cust-${testId}`,
        userId,
        businessName: 'Tax Default Verification Biz',
        ownerName: 'Test Owner',
        merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
      },
    });
    businessId = business.id;
  });

  afterAll(async () => {
    // Cleanup in order
    await prisma.invoiceLine.deleteMany({ where: { invoice: { businessId } } });
    await prisma.invoice.deleteMany({ where: { businessId } });
    await prisma.expense.deleteMany({ where: { businessId } });
    await prisma.businessMember.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.platform.deleteMany({ where: { id: platformId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('proves invoice.vatRate defaults to 0 when omitted', async () => {
    const invoice = await prisma.invoice.create({
      data: {
        businessId,
        externalRef: `inv-ref-${Date.now()}`,
        invoiceNumber: `WX-2026-${Math.floor(100 + Math.random() * 900)}`,
        customerName: 'Default Tax Customer',
        issueDate: new Date(Date.UTC(2026, 2, 15)),
        dueDate: new Date(Date.UTC(2026, 2, 30)),
        subtotal: 10000,
        total: 10000,
        // vatRate is deliberately OMITTED
      },
    });

    expect(Number(invoice.vatRate)).toBe(0);
    expect(Number(invoice.vatAmount)).toBe(0);
  });

  it('proves expense.isDeductible defaults to false when omitted', async () => {
    const expense = await prisma.expense.create({
      data: {
        businessId,
        externalRef: `exp-ref-${Date.now()}`,
        category: 'office_supplies',
        description: 'Printer ink',
        amount: 5000,
        expenseDate: new Date(Date.UTC(2026, 2, 15)),
        // isDeductible is deliberately OMITTED
      },
    });

    expect(expense.isDeductible).toBe(false);
  });
});
