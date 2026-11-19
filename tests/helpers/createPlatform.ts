import { prisma } from '../../src/db/client.js';
import { hashToken } from '../../src/lib/token.js';

export async function createPlatformWithKey(params: {
  name: string;
  key: string;
  ownerUserId: string;
  extra?: Record<string, unknown>;
}) {
  const platform = await prisma.platform.create({
    data: {
      name: params.name,
      ownerUserId: params.ownerUserId,
      approvalStatus: 'ACTIVE',
      apiKeyHash: hashToken(params.key),
      apiKeyPrefix: params.key.slice(0, 16),
      ...params.extra,
    },
  });

  await prisma.platformApiKey.create({
    data: {
      platformId: platform.id,
      label: 'default',
      prefix: params.key.slice(0, 16),
      keyHash: hashToken(params.key),
      createdByUserId: params.ownerUserId,
    },
  });

  return platform;
}
