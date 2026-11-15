import type { ExternalAdmin } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma, type DbClient } from './client.js';

export interface CreateAdminParams {
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
 * Lists all partner platforms with device and merchant account counts.
 */
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

  const bizIds = items.map((b) => b.id);
  const devices = await db.externalDevice.findMany({
    where: { businessId: { in: bizIds } },
    select: { id: true, businessId: true },
  });
  const deviceCounts = new Map<string, number>();
  for (const d of devices) {
    deviceCounts.set(d.businessId, (deviceCounts.get(d.businessId) ?? 0) + 1);
  }

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
      deviceCount: deviceCounts.get(b.id) ?? 0,
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
  const [platform, devices, salesCount, invoicesCount, expensesCount, customersCount] =
    await Promise.all([
      db.platform.findUnique({
        where: { id: business.platformId },
        select: { id: true, name: true, isActive: true, subscriptionExpiresAt: true },
      }),
      db.externalDevice.findMany({
        where: { businessId: accountId },
        select: {
          id: true,
          deviceName: true,
          devicePlatform: true,
          activatedAt: true,
          lastSeenAt: true,
          lastSeenIp: true,
          codeExpiresAt: true,
          codeAttempts: true,
        },
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
    stats: {
      salesCount,
      invoicesCount,
      expensesCount,
      customersCount,
    },
    devices: devices.map((d) => ({
      id: d.id,
      deviceName: d.deviceName,
      devicePlatform: d.devicePlatform,
      isActivated: d.activatedAt !== null,
      activatedAt: d.activatedAt?.toISOString() ?? null,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      lastSeenIp: d.lastSeenIp,
    })),
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
 * Lists devices for an account.
 */
export async function listAccountDevicesAdmin(accountId: string, db: DbClient = prisma) {
  const devices = await db.externalDevice.findMany({
    where: { businessId: accountId },
    orderBy: { createdAt: 'desc' },
  });

  return devices.map((d) => ({
    id: d.id,
    platformId: d.platformId,
    businessId: d.businessId,
    deviceName: d.deviceName,
    devicePlatform: d.devicePlatform,
    hasToken: d.tokenHash !== null,
    hasActiveCode: d.codeHash !== null && (d.codeExpiresAt ? d.codeExpiresAt > new Date() : false),
    codeAttempts: d.codeAttempts,
    activatedAt: d.activatedAt?.toISOString() ?? null,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    lastSeenIp: d.lastSeenIp,
    createdAt: d.createdAt.toISOString(),
  }));
}

/**
 * Revokes a device token and record.
 * Returns true if the device was found and deleted, false if it did not exist
 * or did not belong to the specified businessId (IDOR guard).
 */
export async function revokeDeviceAdmin(
  deviceId: string,
  businessId: string,
  db: DbClient = prisma
): Promise<boolean> {
  const result = await db.externalDevice.deleteMany({
    where: { id: deviceId, businessId },
  });
  return result.count > 0;
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
    totalDevices,
    adminTokens,
  ] = await Promise.all([
    db.platform.count(),
    db.platform.count({ where: { isActive: true } }),
    db.business.count(),
    db.business.count({ where: { isActive: true } }),
    db.salesTransaction.count(),
    db.invoice.count(),
    db.expense.count(),
    db.externalDevice.count(),
    db.externalAdmin.findMany({ where: { revokedAt: null } }),
  ]);

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
    entities: {
      sales: totalSales,
      invoices: totalInvoices,
      expenses: totalExpenses,
      devices: totalDevices,
    },
    adminCredentials: {
      activeTokensCount: adminTokens.length,
      warnings,
      tokens: adminTokens.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        hasExpiry: a.expiresAt !== null,
        expiresAt: a.expiresAt?.toISOString() ?? null,
        hasIpAllowlist: a.allowedIps.length > 0,
        allowedIpsCount: a.allowedIps.length,
        lastUsedAt: a.lastUsedAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
    },
  };
}
