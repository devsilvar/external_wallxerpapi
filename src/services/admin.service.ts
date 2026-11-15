import {
  getAccountDetailAdmin,
  getUsageStatsAdmin,
  listAccountsAdmin,
  listPlatformsAdmin,
  searchAuditLogsAdmin,
  updateAccountAdmin,
  updatePlatformAdmin,
} from '../db/admin.repo.js';
import { AppError } from '../lib/errors.js';

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
  }
) {
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

export async function patchAccountAdmin(accountId: string, data: { isActive: boolean }) {
  const existing = await getAccountDetailAdmin(accountId);
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Account not found');
  }
  return updateAccountAdmin(accountId, data);
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
