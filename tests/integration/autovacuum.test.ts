import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/client.js';

interface RelOptionRow {
  relname: string;
  reloptions: string[] | null;
}

describe('Autovacuum tuning verification (P6-04)', () => {
  it('confirms per-table autovacuum thresholds are set on sales_transactions and audit_logs', async () => {
    const rows = await prisma.$queryRaw<RelOptionRow[]>`
      SELECT relname, reloptions
      FROM pg_class
      WHERE relname IN ('sales_transactions', 'audit_logs')
      ORDER BY relname;
    `;

    expect(rows.length).toBe(2);

    const salesRow = rows.find((r) => r.relname === 'sales_transactions');
    expect(salesRow).toBeDefined();
    expect(salesRow!.reloptions).not.toBeNull();
    const salesOpts = salesRow!.reloptions!.join(',');
    expect(salesOpts).toContain('autovacuum_vacuum_scale_factor=0.05');
    expect(salesOpts).toContain('autovacuum_vacuum_threshold=1000');
    expect(salesOpts).toContain('autovacuum_analyze_scale_factor=0.02');
    expect(salesOpts).toContain('autovacuum_analyze_threshold=500');

    const auditRow = rows.find((r) => r.relname === 'audit_logs');
    expect(auditRow).toBeDefined();
    expect(auditRow!.reloptions).not.toBeNull();
    const auditOpts = auditRow!.reloptions!.join(',');
    expect(auditOpts).toContain('autovacuum_vacuum_scale_factor=0.05');
    expect(auditOpts).toContain('autovacuum_vacuum_threshold=1000');
    expect(auditOpts).toContain('autovacuum_analyze_scale_factor=0.02');
    expect(auditOpts).toContain('autovacuum_analyze_threshold=500');
  });
});
