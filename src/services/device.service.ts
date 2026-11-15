import {
  activateDeviceRecord,
  findDeviceByCodeHash,
  findDeviceByTokenHash,
  incrementCodeAttempts,
  revokeDeviceRecord,
  rotateDeviceRecord,
} from '../db/device.repo.js';
import { AppError } from '../lib/errors.js';
import { generateToken, hashToken } from '../lib/token.js';

export interface ActivateResult {
  token: string;
  accountId: string;
  expiresAt: Date | null;
}

export interface RotateResult {
  token: string;
  accountId: string;
  expiresAt: Date | null;
}

/**
 * Activates a dormant device using a one-time activation code.
 * Rejects expired, consumed, or invalid codes with 401 CODE_INVALID.
 * Returns the raw token exactly once.
 */
export async function activateDevice(
  code: string,
  deviceName?: string,
  devicePlatform?: string
): Promise<ActivateResult> {
  if (!code || typeof code !== 'string') {
    throw new AppError(401, 'CODE_INVALID', 'Invalid activation code');
  }

  const codeHash = hashToken(code);
  const now = new Date();

  // Find device by code_hash
  const device = await findDeviceByCodeHash(codeHash);

  if (!device) {
    throw new AppError(401, 'CODE_INVALID', 'Invalid activation code');
  }

  // Check if code has expired
  if (device.codeExpiresAt && device.codeExpiresAt.getTime() <= now.getTime()) {
    await incrementCodeAttempts(device.id);
    throw new AppError(401, 'CODE_INVALID', 'Activation code has expired');
  }

  // Check if already consumed (token already issued)
  if (device.tokenHash) {
    await incrementCodeAttempts(device.id);
    throw new AppError(401, 'CODE_INVALID', 'Activation code has already been consumed');
  }

  // Issue new token
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);

  await activateDeviceRecord({
    deviceId: device.id,
    tokenHash,
    deviceName: deviceName ?? null,
    devicePlatform: devicePlatform ?? null,
    activatedAt: now,
    platformId: device.platformId,
    businessId: device.businessId,
  });

  return {
    token: rawToken,
    accountId: device.businessId,
    expiresAt: device.expiresAt,
  };
}

/**
 * Rotates a device token using Option A (row-per-token model, plan §0.4).
 * Issues a new token and keeps old token valid until now + graceMinutes in one transaction.
 */
export async function rotateDeviceToken(
  currentToken: string,
  graceMinutes = 10
): Promise<RotateResult> {
  const tokenHash = hashToken(currentToken);
  const now = new Date();

  const device = await findDeviceByTokenHash(tokenHash);

  if (!device) {
    throw new AppError(401, 'TOKEN_INVALID', 'Invalid device token');
  }

  if (device.expiresAt && device.expiresAt.getTime() <= now.getTime()) {
    throw new AppError(401, 'TOKEN_EXPIRED', 'Device token has expired');
  }

  if (device.revokedAt && device.revokedAt.getTime() <= now.getTime()) {
    throw new AppError(401, 'TOKEN_INVALID', 'Device token has been revoked');
  }

  const rawNewToken = generateToken();
  const newTokenHash = hashToken(rawNewToken);
  const graceRevokeAt = new Date(now.getTime() + graceMinutes * 60 * 1000);

  const newDevice = await rotateDeviceRecord({
    oldDeviceId: device.id,
    graceRevokeAt,
    newDeviceData: {
      platformId: device.platformId,
      businessId: device.businessId,
      tokenHash: newTokenHash,
      deviceName: device.deviceName,
      devicePlatform: device.devicePlatform,
      activatedAt: now,
    },
  });

  return {
    token: rawNewToken,
    accountId: newDevice.businessId,
    expiresAt: newDevice.expiresAt,
  };
}

/**
 * Revokes a device token immediately (bypasses grace window, plan §0.4).
 * Used by device self-revocation or operator CLI.
 */
export async function revokeDevice(
  deviceId: string,
  actor: 'device' | 'admin' | 'cli' = 'device'
): Promise<void> {
  await revokeDeviceRecord({
    deviceId,
    actor,
    now: new Date(),
  });
}
