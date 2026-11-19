import {
  createAdmin,
  findAdminById,
  findPlatformById,
  getAccountDetailAdmin,
  getUsageStatsAdmin,
  listAccountsAdmin,
  listAdmins,
  listPlatformsAdmin,
  revokeAdmin,
  searchAuditLogsAdmin,
  updateAccountAdmin,
  updatePlatformAdmin,
} from '../db/admin.repo.js';
import { createAuditLog } from '../db/scoped.js';
import { AppError } from '../lib/errors.js';
import { generateToken, hashToken } from '../lib/token.js';
import type { CreateAdminInput } from '../validators/admin.validator.js';

export async function fetchPlatformsAdmin() {
  return listPlatformsAdmin();
}

export async function patchPlatformAdmin(
  platformId: string,
  data: {
    isActive?: boolean;
    suspendedReason?: string | null;
    flatFeeNgn?: string | null;
    subscriptionExpiresAt?: string | null;
  },
  actor?: string
) {
  const existing = await findPlatformById(platformId);

  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Platform not found');
  }

  const expiresAt = data.subscriptionExpiresAt ? new Date(data.subscriptionExpiresAt) : undefined;

  const updated = await updatePlatformAdmin(platformId, {
    isActive: data.isActive,
    suspendedReason: data.suspendedReason,
    flatFeeNgn: data.flatFeeNgn,
    subscriptionExpiresAt: expiresAt,
  });

  if (!updated) {
    throw new AppError(404, 'NOT_FOUND', 'Platform not found');
  }

  await createAuditLog(null, {
    actor: actor ?? 'admin',
    action: 'PLATFORM_UPDATED',
    platformId,
    resourceType: 'platform',
    resourceId: platformId,
    oldData: {
      isActive: existing.isActive,
      suspendedReason: existing.suspendedReason,
      flatFeeNgn: existing.flatFeeNgn?.toString() ?? null,
      subscriptionExpiresAt: existing.subscriptionExpiresAt?.toISOString() ?? null,
    },
    newData: {
      isActive: updated.isActive,
      suspendedReason: updated.suspendedReason,
      flatFeeNgn: updated.flatFeeNgn,
      subscriptionExpiresAt: updated.subscriptionExpiresAt,
    },
  });

  return updated;
}

export async function fetchAccountsAdmin(params: {
  platformId?: string;
  search?: string;
  limit: number;
  cursor?: string;
}) {
  return listAccountsAdmin(params);
}

export async function fetchAccountDetailAdmin(accountId: string) {
  const account = await getAccountDetailAdmin(accountId);
  if (!account) {
    throw new AppError(404, 'NOT_FOUND', 'Account not found');
  }
  return account;
}

export async function patchAccountAdmin(
  accountId: string,
  data: { isActive: boolean },
  actor?: string
) {
  const existing = await getAccountDetailAdmin(accountId);
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Account not found');
  }

  const updated = await updateAccountAdmin(accountId, data);

  await createAuditLog(existing.id, {
    actor: actor ?? 'admin',
    action: 'ACCOUNT_UPDATED',
    platformId: existing.platform?.id ?? null,
    resourceType: 'business',
    resourceId: accountId,
    oldData: {
      isActive: existing.isActive,
    },
    newData: {
      isActive: updated.isActive,
    },
  });

  return updated;
}

export async function fetchAuditLogsAdmin(params: {
  actor?: string;
  action?: string;
  businessId?: string;
  platformId?: string;
  since?: string;
  limit: number;
  cursor?: string;
}) {
  const sinceDate = params.since ? new Date(params.since) : undefined;
  return searchAuditLogsAdmin({
    ...params,
    since: sinceDate,
  });
}

export async function fetchUsageStatsAdmin() {
  return getUsageStatsAdmin();
}

/**
 * Lists all administrator tokens with metadata only (never the SHA-256 token hash).
 */
export async function fetchAdminsAdmin() {
  const admins = await listAdmins();
  return admins.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    createdAt: a.createdAt.toISOString(),
    lastUsedAt: a.lastUsedAt?.toISOString() ?? null,
    expiresAt: a.expiresAt?.toISOString() ?? null,
    allowedIpsCount: a.allowedIps.length,
    revokedAt: a.revokedAt?.toISOString() ?? null,
  }));
}

/**
 * Mints a new administrative credential.
 * Returns the raw token string EXACTLY ONCE alongside the created metadata.
 */
export async function createAdminTokenAdmin(input: CreateAdminInput, actor?: string) {
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

  const admin = await createAdmin({
    name: input.name,
    tokenHash,
    role: input.role,
    expiresAt,
    allowedIps: input.allowedIps ?? [],
  });

  await createAuditLog(null, {
    actor: actor ?? 'admin',
    action: 'ADMIN_TOKEN_CREATED',
    resourceType: 'external_admin',
    resourceId: admin.id,
    newData: {
      name: admin.name,
      role: admin.role,
      expiresAt: admin.expiresAt?.toISOString() ?? null,
      allowedIpsCount: admin.allowedIps.length,
    },
  });

  return {
    admin: {
      id: admin.id,
      name: admin.name,
      role: admin.role,
      createdAt: admin.createdAt.toISOString(),
      lastUsedAt: null,
      expiresAt: admin.expiresAt?.toISOString() ?? null,
      allowedIpsCount: admin.allowedIps.length,
      revokedAt: null,
    },
    rawToken,
  };
}

/**
 * Revokes an administrative token.
 */
export async function revokeAdminTokenAdmin(adminId: string, actor?: string) {
  const existing = await findAdminById(adminId);

  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Administrator token not found');
  }

  const revoked = await revokeAdmin(adminId);

  await createAuditLog(null, {
    actor: actor ?? 'admin',
    action: 'ADMIN_TOKEN_REVOKED',
    resourceType: 'external_admin',
    resourceId: adminId,
    oldData: {
      revokedAt: existing.revokedAt?.toISOString() ?? null,
    },
    newData: {
      revokedAt: revoked.revokedAt?.toISOString() ?? null,
    },
  });

  return {
    id: revoked.id,
    name: revoked.name,
    revokedAt: revoked.revokedAt?.toISOString() ?? null,
  };
}
