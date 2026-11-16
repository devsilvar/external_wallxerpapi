import { PrismaClient, Prisma } from '@prisma/client';

// Prisma's default pool is (2 × CPU cores + 1) connections per client. Against a
// shared, connection-capped database that is far too many once several test files
// run in parallel, and the pooler starts closing connections mid-transaction.
function withConnectionLimit(url: string | undefined, limit: string | undefined): string | undefined {
  if (!url || !limit || /[?&]connection_limit=/.test(url)) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connection_limit=${encodeURIComponent(limit)}`;
}

const datasourceUrl = withConnectionLimit(
  process.env['DATABASE_URL'],
  process.env['DATABASE_CONNECTION_LIMIT']
);

export const prisma = new PrismaClient({
  ...(datasourceUrl ? { datasourceUrl } : {}),
  log: process.env['NODE_ENV'] === 'test' ? [] : ['warn', 'error'],
});

export type PrismaTransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export type DbClient = PrismaClient | PrismaTransactionClient;

export { Prisma };
export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;
