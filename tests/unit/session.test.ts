import { describe, expect, it, vi } from 'vitest';
import {
  findActiveSession,
  issueSession,
  revokeSession,
  rotateSession,
} from '../../src/lib/session.js';
import { hashToken } from '../../src/lib/token.js';

describe('Developer Portal Sessions (src/lib/session.ts)', () => {
  it('5. issueSession stores SHA-256 hash at rest, never the raw token', async () => {
    let capturedCreateData: any = null;

    const mockDb: any = {
      session: {
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          capturedCreateData = data;
          return {
            id: 'sess-123',
            ...data,
            createdAt: new Date(),
            lastSeenAt: new Date(),
          };
        }),
      },
    };

    const { rawToken, session } = await issueSession(
      {
        userId: 'user-456',
        platformId: 'plat-789',
        ip: '127.0.0.1',
        userAgent: 'Vitest/TestRunner',
      },
      mockDb
    );

    expect(rawToken).toBeDefined();
    expect(rawToken).toHaveLength(43); // 32-byte base64url
    expect(capturedCreateData).toBeDefined();
    // Prove token stored is the hash, NOT the raw token
    expect(capturedCreateData.tokenHash).toBe(hashToken(rawToken));
    expect(capturedCreateData.tokenHash).not.toBe(rawToken);
    expect(capturedCreateData.userId).toBe('user-456');
    expect(capturedCreateData.platformId).toBe('plat-789');
    expect(session.id).toBe('sess-123');
  });

  it('6. An expired session is rejected by findActiveSession', async () => {
    const expiredDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
    const mockDb: any = {
      session: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'sess-expired',
          tokenHash: 'hash-abc',
          userId: 'user-1',
          expiresAt: expiredDate,
          revokedAt: null,
        }),
      },
    };

    const active = await findActiveSession('hash-abc', mockDb);
    expect(active).toBeNull();
  });

  it('7. A revoked session is rejected by findActiveSession', async () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 12);
    const mockDb: any = {
      session: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'sess-revoked',
          tokenHash: 'hash-def',
          userId: 'user-2',
          expiresAt: futureDate,
          revokedAt: new Date(), // revoked now
        }),
      },
    };

    const active = await findActiveSession('hash-def', mockDb);
    expect(active).toBeNull();
  });

  it('8. Session TTL respects the config or passed value', async () => {
    const customTtlHours = 24;
    let createdExpiresAt: Date | null = null;

    const mockDb: any = {
      session: {
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          createdExpiresAt = data.expiresAt;
          return { id: 'sess-ttl', ...data };
        }),
      },
    };

    const before = Date.now();
    await issueSession(
      {
        userId: 'user-ttl',
        ttlHours: customTtlHours,
      },
      mockDb
    );
    const after = Date.now();

    expect(createdExpiresAt).not.toBeNull();
    const expectedExpiryMin = before + customTtlHours * 3600 * 1000;
    const expectedExpiryMax = after + customTtlHours * 3600 * 1000;

    expect(createdExpiresAt!.getTime()).toBeGreaterThanOrEqual(expectedExpiryMin);
    expect(createdExpiresAt!.getTime()).toBeLessThanOrEqual(expectedExpiryMax);
  });

  it('revokeSession sets revokedAt on the matching session', async () => {
    const mockDb: any = {
      session: {
        update: vi.fn().mockResolvedValue({
          id: 'sess-target',
          revokedAt: new Date(),
        }),
      },
    };

    const res = await revokeSession('hash-xyz', mockDb);
    expect(mockDb.session.update).toHaveBeenCalledWith({
      where: { tokenHash: 'hash-xyz' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(res?.revokedAt).toBeInstanceOf(Date);
  });

  it('rotateSession revokes the old session and creates a new one in transaction', async () => {
    const mockDb: any = {
      session: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'old-sess',
          userId: 'user-rotate',
          platformId: 'plat-rotate',
          expiresAt: new Date(Date.now() + 100000),
          revokedAt: null,
          ip: '1.2.3.4',
          userAgent: 'TestBrowser',
        }),
        update: vi.fn().mockReturnValue(Promise.resolve({ id: 'old-sess', revokedAt: new Date() })),
        create: vi.fn().mockReturnValue(Promise.resolve({ id: 'new-sess', userId: 'user-rotate', platformId: 'plat-rotate' })),
      },
      $transaction: vi.fn().mockImplementation(async (promises: any[]) => {
        return [
          { id: 'old-sess', revokedAt: new Date() },
          { id: 'new-sess', userId: 'user-rotate', platformId: 'plat-rotate' },
        ];
      }),
    };

    const res = await rotateSession('old-sess', undefined, mockDb);
    expect(res).not.toBeNull();
    expect(res?.rawToken).toBeDefined();
    expect(res?.session.id).toBe('new-sess');
    expect(mockDb.$transaction).toHaveBeenCalled();
  });
});
