import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { prisma } from '../../src/db/client.js';
import { generateApiKey, hashToken } from '../../src/lib/token.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 8000): Promise<T | null> {
 const deadline = Date.now() + timeoutMs;
 while (Date.now() < deadline) {
 const value = await fn();
 if (value) return value;
 await sleep(150);
 }
 return null;
}

describe('API usage rollup and mutation audit (tests/integration/api-usage-audit.test.ts)', () => {
 const testId = `usage-audit-${Date.now()}`;
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
 fullName: 'Usage Audit Tester',
 },
 });
 userId = user.id;

 apiKey = generateApiKey('sk_ext_live_');
 const platform = await prisma.platform.create({
 data: {
 name: `${testId} Platform`,
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
 businessName: 'Usage Audit Biz',
 ownerName: 'Owner',
 merchantId: `WOWO${Math.floor(1000000 + Math.random() * 9000000)}`,
 },
 });
 businessId = biz.id;
 });

 afterAll(async () => {
 await prisma.auditLog.deleteMany({ where: { businessId } });
 await prisma.apiUsageDaily.deleteMany({ where: { platformId } });
 await prisma.saleLineItem.deleteMany({ where: { sale: { businessId } } });
 await prisma.salesTransaction.deleteMany({ where: { businessId } });
 await prisma.externalTombstone.deleteMany({ where: { businessId } });
 await prisma.business.deleteMany({ where: { id: businessId } });
 await prisma.platform.deleteMany({ where: { id: platformId } });
 await prisma.user.deleteMany({ where: { id: userId } });
 });

 it('records an audit entry when a partner creates a sale', async () => {
 const res = await request(app)
 .post(`/api/external/v1/accounts/${businessId}/sales`)
 .set('Authorization', `Bearer ${apiKey}`)
 .send({
 referenceId: `audit-sale-${testId}`,
 amount: '2500.00',
 source: 'api',
 transactionDate: '2026-11-12',
 });

 expect(res.status).toBe(201);

 const created = res.body.data;
 const entry = await waitFor(() =>
 prisma.auditLog.findFirst({
 where: { businessId, action: 'SALE_CREATED', resourceId: created.id },
 })
 );

 expect(entry).not.toBeNull();
 expect(entry!.platformId).toBe(platformId);
 expect(entry!.resourceType).toBe('sale');
 expect(entry!.actor).toContain('platform:');
 });

 it('does not audit read-only requests', async () => {
 const before = await prisma.auditLog.count({ where: { businessId } });

 const res = await request(app)
 .get(`/api/external/v1/accounts/${businessId}/sales`)
 .set('Authorization', `Bearer ${apiKey}`);

 expect(res.status).toBe(200);

 await sleep(750);
 const after = await prisma.auditLog.count({ where: { businessId } });
 expect(after).toBe(before);
 });

 it('records an audit entry when a partner deletes a sale', async () => {
 const sale = await request(app)
 .post(`/api/external/v1/accounts/${businessId}/sales`)
 .set('Authorization', `Bearer ${apiKey}`)
 .send({
 referenceId: `delete-audit-sale-${testId}`,
 amount: '1000.00',
 source: 'api',
 transactionDate: '2026-11-12',
 });
 expect(sale.status).toBe(201);

 const del = await request(app)
 .delete(`/api/external/v1/accounts/${businessId}/sales/${sale.body.data.id}`)
 .set('Authorization', `Bearer ${apiKey}`);
 expect(del.status).toBe(200);

 const entry = await waitFor(() =>
 prisma.auditLog.findFirst({
 where: {
 businessId,
 action: 'SALE_DELETED',
 resourceId: sale.body.data.id,
 },
 })
 );

 expect(entry).not.toBeNull();
 expect(entry!.resourceType).toBe('sale');
 });

 it('counts every authenticated partner call in the daily usage rollup', async () => {
 const rollup = await waitFor(() =>
 prisma.apiUsageDaily
 .findFirst({ where: { platformId } })
 .then((row) => (row && row.requestCount >= 4 ? row : null))
 );

 expect(rollup).not.toBeNull();
 expect(rollup!.errorCount).toBe(0);
 });
});
