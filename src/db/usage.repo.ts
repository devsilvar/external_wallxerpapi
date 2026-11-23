import { prisma, type DbClient } from './client.js';
import { addUtcDays, lagosDateOnly, toDateOnly } from '../lib/dates.js';

export interface UsagePoint {
 date: string;
 requests: number;
 errors: number;
}

export interface PlatformUsage {
 platformId: string;
 platformName: string;
 requests: number;
 errors: number;
}

/**
 * Records one authenticated partner API request against the platform's
 * Africa/Lagos calendar day.
 *
 * A single INSERT ... ON CONFLICT rather than Prisma's `upsert`: concurrent
 * requests for the same platform/day race on the unique key, and Prisma's
 * read-then-write upsert surfaces that race as a P2002. Postgres resolves it
 * atomically.
 */
export async function recordApiRequest(
 platformId: string,
 failed: boolean,
 db: DbClient = prisma
): Promise<void> {
 const dateKey = toDateOnly(lagosDateOnly());
 const errorDelta = failed ? 1 : 0;

 await db.$executeRaw`
 INSERT INTO "api_usage_daily"
 ("id", "platform_id", "date", "request_count", "error_count", "created_at", "updated_at")
 VALUES (gen_random_uuid()::text, ${platformId}, ${dateKey}::date, 1, ${errorDelta}, NOW(), NOW())
 ON CONFLICT ("platform_id", "date")
 DO UPDATE SET
 "request_count" = "api_usage_daily"."request_count" + 1,
 "error_count" = "api_usage_daily"."error_count" + ${errorDelta},
 "updated_at" = NOW()
 `;
}

/**
 * Returns the platform's usage rows for [from, to], gap-filled so every day in
 * the window is present (chart consumers should never have to interpolate).
 */
export async function fetchUsageSeries(
 platformId: string,
 from: Date,
 to: Date,
 db: DbClient = prisma
): Promise<UsagePoint[]> {
 const rows = await db.apiUsageDaily.findMany({
 where: { platformId, date: { gte: from, lte: to } },
 orderBy: { date: 'asc' },
 });

 const byDate = new Map(
 rows.map((row) => [toDateOnly(row.date), row] as const)
 );

 const series: UsagePoint[] = [];
 for (let cursor = from; cursor.getTime() <= to.getTime(); cursor = addUtcDays(cursor, 1)) {
 const key = toDateOnly(cursor);
 const row = byDate.get(key);
 series.push({
 date: key,
 requests: row?.requestCount ?? 0,
 errors: row?.errorCount ?? 0,
 });
 }
 return series;
}

/**
 * Aggregates every platform's traffic over [from, to]. Used by the operator
 * admin usage page, which is not scoped to a single developer.
 */
export async function fetchPlatformUsageSince(
 from: Date,
 db: DbClient = prisma
): Promise<PlatformUsage[]> {
 const [rows, platforms] = await Promise.all([
 db.apiUsageDaily.groupBy({
 by: ['platformId'],
 where: { date: { gte: from } },
 _sum: { requestCount: true, errorCount: true },
 }),
 db.platform.findMany({ select: { id: true, name: true } }),
 ]);

 const nameById = new Map(platforms.map((p) => [p.id, p.name] as const));

 return rows
 .map((row) => ({
 platformId: row.platformId,
 platformName: nameById.get(row.platformId) ?? 'Unknown platform',
 requests: row._sum.requestCount ?? 0,
 errors: row._sum.errorCount ?? 0,
 }))
 .sort((a, b) => b.requests - a.requests);
}

/** Deletes usage rows older than the cutoff. Returns rows removed. */
export async function purgeApiUsageBefore(
 cutoff: Date,
 db: DbClient = prisma
): Promise<{ count: number }> {
 const result = await db.apiUsageDaily.deleteMany({
 where: { date: { lt: cutoff } },
 });
 return { count: result.count };
}
