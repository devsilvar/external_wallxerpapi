import type { AdminSession, ExternalAdmin } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma, type DbClient } from './client.js';
import { fetchPlatformUsageSince } from './usage.repo.js';
import { addUtcDays, lagosDateOnly } from '../lib/dates.js';

export interface CreateAdminParams {
email?: string | null;
passwordHash?: string | null;
  name: string;
  tokenHash: string;
  role?: string;
  expiresAt?: Date | null;
  allowedIps?: string[];
}

/**
 * Creates a new administrative user/token.
 */
export async function createAdmin(
  params: CreateAdminParams,
  db: DbClient = prisma
): Promise<ExternalAdmin> {
  return db.externalAdmin.create({
    data: {
      name: params.name,
      tokenHash: params.tokenHash,
      role: params.role ?? 'admin',
      expiresAt: params.expiresAt ?? null,
      allowedIps: params.allowedIps ?? [],
email: params.email ? params.email.trim().toLowerCase() : null,
passwordHash: params.passwordHash ?? null,
    },
  });
}

/**
 * Finds an admin record by the SHA-256 hash of their bearer token.
 */
export async function findAdminByTokenHash(
  tokenHash: string,
  db: DbClient = prisma
): Promise<ExternalAdmin | null> {
  return db.externalAdmin.findUnique({
    where: { tokenHash },
  });
}

/**
 * Finds an admin record by ID.
 */
export async function findAdminById(
  adminId: string,
  db: DbClient = prisma
): Promise<ExternalAdmin | null> {
  return db.externalAdmin.findUnique({
    where: { id: adminId },
  });
}

/**
 * Finds a platform by ID.
 */
export async function findPlatformById(
  platformId: string,
  db: DbClient = prisma
) {
  return db.platform.findUnique({
    where: { id: platformId },
  });
}

/**
 * Updates an admin's lastUsedAt timestamp asynchronously.
 */
export async function updateAdminLastUsed(
  adminId: string,
  at: Date = new Date(),
  db: DbClient = prisma
): Promise<void> {
  await db.externalAdmin
    .update({
      where: { id: adminId },
      data: { lastUsedAt: at },
    })
    .catch(() => {
      // Fire-and-forget: do not block response if timestamp update fails
    });
}

/**
 * Revokes an administrative token.
 */
export async function revokeAdmin(
  adminId: string,
  at: Date = new Date(),
  db: DbClient = prisma
): Promise<ExternalAdmin> {
  return db.externalAdmin.update({
    where: { id: adminId },
    data: { revokedAt: at },
  });
}

/**
 * Lists all administrative tokens (without secrets) for credential auditing.
 */
export async function listAdmins(db: DbClient = prisma): Promise<ExternalAdmin[]> {
  return db.externalAdmin.findMany({
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Lists all partner platforms with merchant account counts.
 */
/**
 * Finds an admin by login email. Case-insensitive: emails are stored lowercased.
 */
export async function findAdminByEmail(
email: string,
db: DbClient = prisma
): Promise<ExternalAdmin | null> {
return db.externalAdmin.findUnique({
where: { email: email.trim().toLowerCase() },
});
}

/**
 * Attaches login credentials to an existing admin (used by the CLI to upgrade
 * token-only operators created before admins had their own identity).
 */
export async function setAdminCredentials(
adminId: string,
credentials: { email: string; passwordHash: string },
db: DbClient = prisma
): Promise<ExternalAdmin> {
return db.externalAdmin.update({
where: { id: adminId },
data: {
email: credentials.email.trim().toLowerCase(),
passwordHash: credentials.passwordHash,
},
});
}

export async function createAdminSession(
params: {
adminId: string;
tokenHash: string;
expiresAt: Date;
ip?: string | null;
userAgent?: string | null;
},
db: DbClient = prisma
): Promise<AdminSession> {
return db.adminSession.create({
data: {
adminId: params.adminId,
tokenHash: params.tokenHash,
expiresAt: params.expiresAt,
ip: params.ip ?? null,
userAgent: params.userAgent ?? null,
},
});
}

/**
 * Resolves an admin session token to its admin, rejecting revoked and expired
 * sessions. Returns null for anything that is not a live admin session.
 */
export async function findActiveAdminSession(
tokenHash: string,
db: DbClient = prisma
): Promise<(AdminSession & { admin: ExternalAdmin }) | null> {
const session = await db.adminSession.findUnique({
where: { tokenHash },
include: { admin: true },
});

if (!session) return null;
if (session.revokedAt !== null) return null;
if (session.expiresAt.getTime() < Date.now()) return null;
if (session.admin.revokedAt !== null) return null;

return session;
}

export async function touchAdminSession(
sessionId: string,
at: Date = new Date(),
db: DbClient = prisma
): Promise<void> {
await db.adminSession
.update({ where: { id: sessionId }, data: { lastSeenAt: at } })
.catch(() => {
// Fire-and-forget: a stale lastSeenAt must never fail the request
});
}

export async function revokeAdminSession(
tokenHash: string,
at: Date = new Date(),
db: DbClient = prisma
): Promise<void> {
await db.adminSession.updateMany({
where: { tokenHash, revokedAt: null },
data: { revokedAt: at },
});
}

export async function listPlatformsAdmin(db: DbClient = prisma) {
  const platforms = await db.platform.findMany({
    orderBy: { createdAt: 'desc' },
  });

  const platformSummaries = await Promise.all(
    platforms.map(async (p) => {
      const [accountCount, activeAccountCount] = await Promise.all([
        db.business.count({ where: { platformId: p.id } }),
        db.business.count({ where: { platformId: p.id, isActive: true } }),
      ]);
      return {
        id: p.id,
        name: p.name,
        ownerUserId: p.ownerUserId,
        isActive: p.isActive,
        suspendedAt: p.suspendedAt?.toISOString() ?? null,
        suspendedReason: p.suspendedReason,
        flatFeeNgn: p.flatFeeNgn?.toString() ?? null,
        subscriptionExpiresAt: p.subscriptionExpiresAt?.toISOString() ?? null,
        totalAccounts: accountCount,
        activeAccounts: activeAccountCount,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    })
  );

  return platformSummaries;
}

/**
 * Updates a platform (suspend/resume, fee, subscription extension).
 */
export async function updatePlatformAdmin(
  platformId: string,
  data: {
    isActive?: boolean;
    suspendedReason?: string | null;
    flatFeeNgn?: string | null;
    subscriptionExpiresAt?: Date | null;
  },
  db: DbClient = prisma
) {
  const updatePayload: Record<string, unknown> = {};

  if (data.isActive !== undefined) {
    updatePayload['isActive'] = data.isActive;
    updatePayload['suspendedAt'] = data.isActive ? null : new Date();
    if (!data.isActive && data.suspendedReason) {
      updatePayload['suspendedReason'] = data.suspendedReason;
    } else if (data.isActive) {
      updatePayload['suspendedReason'] = null;
    }
  }

  if (data.flatFeeNgn !== undefined) {
    updatePayload['flatFeeNgn'] = data.flatFeeNgn;
  }

  if (data.subscriptionExpiresAt !== undefined) {
    updatePayload['subscriptionExpiresAt'] = data.subscriptionExpiresAt;
  }

  try {
    return await db.platform.update({
      where: { id: platformId },
      data: updatePayload,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return null;
    }
    throw err;
  }
}
/**
 * Lists accounts with filtering and pagination for operators.
 */
export async function listAccountsAdmin(
  params: {
    platformId?: string;
    search?: string;
    limit: number;
    cursor?: string;
  },
  db: DbClient = prisma
) {
  const where: Record<string, unknown> = {};

  if (params.platformId) {
    where['platformId'] = params.platformId;
  }

  if (params.search) {
    where['OR'] = [
      { businessName: { contains: params.search, mode: 'insensitive' } },
      { merchantId: { contains: params.search, mode: 'insensitive' } },
      { externalCustomerId: { contains: params.search, mode: 'insensitive' } },
    ];
  }

  const take = params.limit + 1;
  const businesses = await db.business.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });

  const hasMore = businesses.length > params.limit;
  const items = hasMore ? businesses.slice(0, params.limit) : businesses;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  const platformIds = [...new Set(items.map((b) => b.platformId))];
  const platforms = await db.platform.findMany({
    where: { id: { in: platformIds } },
    select: { id: true, name: true, isActive: true },
  });
  const platformMap = new Map(platforms.map((p) => [p.id, p]));

  return {
    items: items.map((b) => ({
      id: b.id,
      platformId: b.platformId,
      platformName: platformMap.get(b.platformId)?.name ?? 'Unknown',
      externalCustomerId: b.externalCustomerId,
      merchantId: b.merchantId,
      businessName: b.businessName,
      ownerName: b.ownerName,
      isActive: b.isActive,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    })),
    page: {
      limit: params.limit,
      nextCursor,
      hasMore,
    },
  };
}

/**
 * Retrieves full merchant detail including live transaction and invoice counts.
 */
export async function getAccountDetailAdmin(accountId: string, db: DbClient = prisma) {
  const business = await db.business.findUnique({
    where: { id: accountId },
  });

  if (!business) {
    return null;
  }

  // Live counts across entity tables and relations
  const [platform, sales, invoices, expenses, customers] =
    await Promise.all([
      db.platform.findUnique({
        where: { id: business.platformId },
        select: { id: true, name: true, isActive: true, subscriptionExpiresAt: true },
      }),
      db.salesTransaction.count({ where: { businessId: accountId } }),
      db.invoice.count({ where: { businessId: accountId } }),
      db.expense.count({ where: { businessId: accountId } }),
      db.customer.count({ where: { businessId: accountId } }),
    ]);

  return {
    id: business.id,
    platform,
    externalCustomerId: business.externalCustomerId,
    merchantId: business.merchantId,
    businessName: business.businessName,
    ownerName: business.ownerName,
    contactEmail: business.contactEmail,
    contactPhone: business.contactPhone,
    address: business.address,
    city: business.city,
    state: business.state,
    isActive: business.isActive,
    counts: {
      sales,
      invoices,
      expenses,
      customers,
    },
    stats: {
      salesCount: sales,
      invoicesCount: invoices,
      expensesCount: expenses,
      customersCount: customers,
    },
    createdAt: business.createdAt.toISOString(),
    updatedAt: business.updatedAt.toISOString(),
  };
}

/**
 * Updates an account (suspend/resume).
 */
export async function updateAccountAdmin(
  accountId: string,
  data: { isActive: boolean },
  db: DbClient = prisma
) {
  return db.business.update({
    where: { id: accountId },
    data: { isActive: data.isActive },
  });
}

/**
 * Searches audit logs with filtering and pagination.
 */
export async function searchAuditLogsAdmin(
  params: {
    actor?: string;
    action?: string;
    businessId?: string;
    platformId?: string;
    since?: Date;
    limit: number;
    cursor?: string;
  },
  db: DbClient = prisma
) {
  const where: Record<string, unknown> = {};

  if (params.actor) where['actor'] = params.actor;
  if (params.action) where['action'] = params.action;
  if (params.businessId) where['businessId'] = params.businessId;
  if (params.platformId) where['platformId'] = params.platformId;
  if (params.since) where['createdAt'] = { gte: params.since };

  const take = params.limit + 1;
  const logs = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });

  const hasMore = logs.length > params.limit;
  const items = hasMore ? logs.slice(0, params.limit) : logs;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  return {
    items: items.map((l) => ({
      id: l.id,
      platformId: l.platformId,
      businessId: l.businessId,
      actor: l.actor,
      action: l.action,
      resourceType: l.resourceType,
      resourceId: l.resourceId,
      metadata: { oldData: l.oldData, newData: l.newData },
      createdAt: l.createdAt.toISOString(),
    })),
    page: {
      limit: params.limit,
      nextCursor,
      hasMore,
    },
  };
}

/**
 * Aggregates system usage statistics and surfaces admin token security posture.
 */
export async function getUsageStatsAdmin(db: DbClient = prisma) {
  const [
    totalPlatforms,
    activePlatforms,
    totalAccounts,
    activeAccounts,
    totalSales,
    totalInvoices,
    totalExpenses,
    adminTokens,
  ] = await Promise.all([
    db.platform.count(),
    db.platform.count({ where: { isActive: true } }),
    db.business.count(),
    db.business.count({ where: { isActive: true } }),
    db.salesTransaction.count(),
    db.invoice.count(),
    db.expense.count(),
    db.externalAdmin.findMany({ where: { revokedAt: null } }),
  ]);

  // API traffic rollup for the same 30-day window the developer portal shows.
const API_USAGE_WINDOW_DAYS = 30;
const apiUsageByPlatform = await fetchPlatformUsageSince(
 addUtcDays(lagosDateOnly(), -(API_USAGE_WINDOW_DAYS - 1)),
 db
);
const apiRequests = apiUsageByPlatform.reduce((sum, p) => sum + p.requests, 0);
const apiErrors = apiUsageByPlatform.reduce((sum, p) => sum + p.errors, 0);

// Security warning surface (P8-04): detect non-expiring perpetual admin tokens
  const warnings: string[] = [];
  for (const admin of adminTokens) {
    if (admin.expiresAt === null) {
      warnings.push(`Admin credential '${admin.name}' has no expiration date (perpetual credential)`);
    }
  }

  return {
    platforms: {
      total: totalPlatforms,
      active: activePlatforms,
    },
    accounts: {
      total: totalAccounts,
      active: activeAccounts,
    },
    sales: { count: totalSales },
    invoices: { count: totalInvoices },
    expenses: { count: totalExpenses },
    entities: {
      sales: totalSales,
      invoices: totalInvoices,
      expenses: totalExpenses,
    },
    api: {
 windowDays: API_USAGE_WINDOW_DAYS,
 requests: apiRequests,
 errors: apiErrors,
 errorRate: apiRequests > 0 ? Math.round((apiErrors / apiRequests) * 10_000) / 100 : 0,
 byPlatform: apiUsageByPlatform,
},
credentials: {
      warnings,
      tokens: adminTokens.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        hasExpiry: a.expiresAt !== null,
        expiresAt: a.expiresAt?.toISOString() ?? null,
        hasIpAllowlist: a.allowedIps.length > 0,
        lastUsedAt: a.lastUsedAt?.toISOString() ?? null,
      })),
    },
    adminCredentials: {
      warnings,
      tokens: adminTokens.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        hasExpiry: a.expiresAt !== null,
        expiresAt: a.expiresAt?.toISOString() ?? null,
        hasIpAllowlist: a.allowedIps.length > 0,
        lastUsedAt: a.lastUsedAt?.toISOString() ?? null,
      })),
    },
  };
}
