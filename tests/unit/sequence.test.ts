import { describe, expect, it } from 'vitest';
import { nextInvoiceNumber, nextMerchantId } from '../../src/services/sequence.service.js';

describe('Atomic sequence allocator (src/services/sequence.service.ts)', () => {
  it('generates 100 distinct invoice numbers concurrently with the correct key format', async () => {
    const businessId = `biz-${Date.now()}`;
    const year = 2026;

    const promises = Array.from({ length: 100 }, () => nextInvoiceNumber(businessId, year));
    const results = await Promise.all(promises);

    expect(results).toHaveLength(100);
    expect(new Set(results).size).toBe(100);

    for (const inv of results) {
      expect(inv).toMatch(/^WX-2026-\d{3,}$/);
    }
  }, 15000);

  it('generates merchant IDs zero-padded to 7 digits matching WOWO0000001 pattern', async () => {
    const merchantId = await nextMerchantId();
    expect(merchantId).toMatch(/^WOWO\d{7,}$/);
  });
});
