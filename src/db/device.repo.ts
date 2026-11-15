import type { ExternalDevice, PrismaClient } from '@prisma/client';
import { prisma, type DbClient } from './client.js';

export async function findDeviceByTokenHash(
  tokenHash: string,
  db: DbClient = prisma
): Promise<ExternalDevice | null> {
  return db.externalDevice.findUnique({
    where: { tokenHash },
  });
}

export async function findDeviceByCodeHash(
  codeHash: string,
  db: DbClient = prisma
): Promise<ExternalDevice | null> {
  return db.externalDevice.findUnique({
    where: { codeHash },
  });
}

export async function incrementCodeAttempts(
  deviceId: string,
  db: DbClient = prisma
): Promise<void> {
  await db.externalDevice.update({
    where: { id: deviceId },
    data: { codeAttempts: { increment: 1 } },
  });
}

export async function updateDeviceLastSeen(
  deviceId: string,
  ip: string | null,
  at: Date = new Date(),
  db: DbClient = prisma
): Promise<void> {
  await db.externalDevice
    .update({
      where: { id: deviceId },
      data: {
        lastSeenAt: at,
        lastSeenIp: ip,
      },
    })
    .catch(() => {
      // Non-critical background update
    });
}

export async function activateDeviceRecord(params: {
  deviceId: string;
  tokenHash: string;
  deviceName?: string | null;
  devicePlatform?: string | null;
  activatedAt: Date;
  platformId: string;
  businessId: string;
  db?: PrismaClient;
}): Promise<void> {
  const db = params.db ?? prisma;

  await db.$transaction(async (tx) => {
    await tx.externalDevice.update({
      where: { id: params.deviceId },
      data: {
        tokenHash: params.tokenHash,
        deviceName: params.deviceName ?? null,
        devicePlatform: params.devicePlatform ?? null,
        activatedAt: params.activatedAt,
        codeHash: null,
        codeExpiresAt: null,
        codeAttempts: 0,
      },
    });

    await tx.auditLog.create({
      data: {
        platformId: params.platformId,
        businessId: params.businessId,
        externalDeviceId: params.deviceId,
        actor: 'device',
        action: 'device.activated',
        resourceType: 'device',
        resourceId: params.deviceId,
      },
    });
  });
}

export async function rotateDeviceRecord(params: {
  oldDeviceId: string;
  graceRevokeAt: Date;
  newDeviceData: {
    platformId: string;
    businessId: string;
    tokenHash: string;
    deviceName?: string | null;
    devicePlatform?: string | null;
    activatedAt: Date;
  };
  db?: PrismaClient;
}): Promise<ExternalDevice> {
  const db = params.db ?? prisma;

  return db.$transaction(async (tx) => {
    // 1. Schedule revocation of the old token at the end of the grace window
    await tx.externalDevice.update({
      where: { id: params.oldDeviceId },
      data: {
        revokedAt: params.graceRevokeAt,
      },
    });

    // 2. Insert new device row (Option A)
    const newDevice = await tx.externalDevice.create({
      data: {
        platformId: params.newDeviceData.platformId,
        businessId: params.newDeviceData.businessId,
        tokenHash: params.newDeviceData.tokenHash,
        deviceName: params.newDeviceData.deviceName ?? null,
        devicePlatform: params.newDeviceData.devicePlatform ?? null,
        activatedAt: params.newDeviceData.activatedAt,
      },
    });

    // 3. Audit log
    await tx.auditLog.create({
      data: {
        platformId: params.newDeviceData.platformId,
        businessId: params.newDeviceData.businessId,
        externalDeviceId: newDevice.id,
        actor: 'device',
        action: 'device.rotated',
        resourceType: 'device',
        resourceId: newDevice.id,
        newData: {
          replacedDeviceId: params.oldDeviceId,
          graceRevokeAt: params.graceRevokeAt.toISOString(),
        },
      },
    });

    return newDevice;
  });
}

export async function revokeDeviceRecord(params: {
  deviceId: string;
  actor: 'device' | 'admin' | 'cli';
  now?: Date;
  db?: PrismaClient;
}): Promise<ExternalDevice> {
  const db = params.db ?? prisma;
  const now = params.now ?? new Date();

  return db.$transaction(async (tx) => {
    const updated = await tx.externalDevice.update({
      where: { id: params.deviceId },
      data: {
        revokedAt: now,
      },
    });

    await tx.auditLog.create({
      data: {
        platformId: updated.platformId,
        businessId: updated.businessId,
        externalDeviceId: updated.id,
        actor: params.actor,
        action: 'device.revoked',
        resourceType: 'device',
        resourceId: updated.id,
        newData: {
          revokedAt: now.toISOString(),
          actor: params.actor,
        },
      },
    });

    return updated;
  });
}

export async function issueActivationCodeRecord(params: {
  businessId: string;
  codeHash: string;
  expiresAt: Date;
  db?: PrismaClient;
}): Promise<ExternalDevice> {
  const db = params.db ?? prisma;
  const now = new Date();

  return db.$transaction(async (tx) => {
    const business = await tx.business.findUnique({
      where: { id: params.businessId },
      select: { platformId: true, id: true },
    });

    if (!business) {
      throw new Error(`Account not found: ${params.businessId}`);
    }

    // Revoke any half-activated device on that account (has codeHash and no tokenHash)
    await tx.externalDevice.updateMany({
      where: {
        businessId: params.businessId,
        tokenHash: null,
        codeHash: { not: null },
      },
      data: {
        revokedAt: now,
      },
    });

    // Find a dormant device (no token, no code, not revoked) or create a new device row
    const dormantDevice = await tx.externalDevice.findFirst({
      where: {
        businessId: params.businessId,
        tokenHash: null,
        codeHash: null,
        revokedAt: null,
      },
    });

    let device: ExternalDevice;
    if (dormantDevice) {
      device = await tx.externalDevice.update({
        where: { id: dormantDevice.id },
        data: {
          codeHash: params.codeHash,
          codeExpiresAt: params.expiresAt,
          codeAttempts: 0,
        },
      });
    } else {
      device = await tx.externalDevice.create({
        data: {
          platformId: business.platformId,
          businessId: business.id,
          codeHash: params.codeHash,
          codeExpiresAt: params.expiresAt,
        },
      });
    }

    // Audit log
    await tx.auditLog.create({
      data: {
        platformId: business.platformId,
        businessId: business.id,
        actor: 'cli',
        action: 'code.issued',
        resourceType: 'business',
        resourceId: business.id,
      },
    });

    return device;
  });
}
