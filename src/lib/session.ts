import type { Session } from '@prisma/client';
import { prisma, type DbClient } from '../db/client.js';
import { generateToken, hashToken } from './token.js';

export interface IssueSessionParams {
  userId: string;
  platformId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  ttlHours?: number;
}

export interface IssuedSession {
  rawToken: string;
  session: Session;
}

const DEFAULT_SESSION_TTL_HOURS = 12;

/**
 * Issues a new developer portal session.
 * Stores only hashToken(rawToken) at rest; returns the raw token to the caller once.
 */
export async function issueSession(
  params: IssueSessionParams,
  db: DbClient = prisma
): Promise<IssuedSession> {
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const ttlHours = params.ttlHours ?? DEFAULT_SESSION_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  const session = await db.session.create({
    data: {
      tokenHash,
      userId: params.userId,
      platformId: params.platformId ?? null,
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
      expiresAt,
    },
  });

  return { rawToken, session };
}

/**
 * Finds an active, non-revoked, non-expired session by token hash.
 */
export async function findActiveSession(
  tokenHash: string,
  db: DbClient = prisma
): Promise<(Session & { user?: any; platform?: any }) | null> {
  const session = await db.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          isActive: true,
          isVerified: true,
        },
      },
      platform: {
        select: {
          id: true,
          name: true,
          approvalStatus: true,
          isActive: true,
          suspendedAt: true,
          suspendedReason: true,
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  // Check revocation and expiration
  if (session.revokedAt !== null || session.expiresAt <= new Date()) {
    return null;
  }

  return session;
}

/**
 * Revokes a session immediately by its token hash.
 */
export async function revokeSession(
  tokenHash: string,
  db: DbClient = prisma
): Promise<Session | null> {
  try {
    return await db.session.update({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
  } catch {
    return null;
  }
}

/**
 * Revokes an existing session by ID and creates a new one in an atomic transaction.
 */
export async function rotateSession(
  sessionId: string,
  options?: { ip?: string | null; userAgent?: string | null; ttlHours?: number },
  db: DbClient = prisma
): Promise<IssuedSession | null> {
  const existing = await db.session.findUnique({ where: { id: sessionId } });
  if (!existing || existing.revokedAt || existing.expiresAt <= new Date()) {
    return null;
  }

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const ttlHours = options?.ttlHours ?? DEFAULT_SESSION_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  if ('$transaction' in db) {
    const [_, newSession] = await (db as any).$transaction([
      db.session.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      }),
      db.session.create({
        data: {
          tokenHash,
          userId: existing.userId,
          platformId: existing.platformId,
          ip: options?.ip ?? existing.ip,
          userAgent: options?.userAgent ?? existing.userAgent,
          expiresAt,
        },
      }),
    ]);
    return { rawToken, session: newSession };
  }

  await db.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
  const newSession = await db.session.create({
    data: {
      tokenHash,
      userId: existing.userId,
      platformId: existing.platformId,
      ip: options?.ip ?? existing.ip,
      userAgent: options?.userAgent ?? existing.userAgent,
      expiresAt,
    },
  });

  return { rawToken, session: newSession };
}

/**
 * Updates lastSeenAt on a session if it hasn't been updated in the last hour.
 */
export async function touchSession(
  sessionId: string,
  lastSeenAt: Date,
  db: DbClient = prisma
): Promise<void> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  if (lastSeenAt < oneHourAgo) {
    void db.session
      .update({
        where: { id: sessionId },
        data: { lastSeenAt: new Date() },
      })
      .catch(() => {});
  }
}
