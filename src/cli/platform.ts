import {
  createPlatform,
  regeneratePlatformApiKey,
  upsertPlatformOwnerUser,
  listPlatforms,
} from '../db/platform.repo.js';
import { generateApiKey, hashToken } from '../lib/token.js';

export interface CreatePlatformResult {
  id: string;
  name: string;
  apiKey: string;
  apiKeyPrefix: string;
}

export async function issuePlatformWithApiKey(params: {
  name: string;
  ownerEmail: string;
  flatFeeNgn?: string;
}): Promise<CreatePlatformResult> {
  const user = await upsertPlatformOwnerUser(params.ownerEmail, `${params.name} Owner`);

  const prefix = 'sk_ext_live_';
  const apiKey = generateApiKey(prefix);
  const apiKeyHash = hashToken(apiKey);
  const apiKeyPrefix = apiKey.slice(0, 16);

  const platform = await createPlatform({
    name: params.name,
    ownerUserId: user.id,
    apiKeyHash,
    apiKeyPrefix,
    flatFeeNgn: params.flatFeeNgn ?? null,
  });

  return {
    id: platform.id,
    name: platform.name,
    apiKey,
    apiKeyPrefix,
  };
}

export async function rotatePlatformApiKey(platformId: string): Promise<{ apiKey: string }> {
  const prefix = 'sk_ext_live_';
  const apiKey = generateApiKey(prefix);
  const apiKeyHash = hashToken(apiKey);
  const apiKeyPrefix = apiKey.slice(0, 16);

  await regeneratePlatformApiKey(platformId, apiKeyHash, apiKeyPrefix);

  return { apiKey };
}

// CLI entrypoint
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'create-platform') {
    const nameIndex = args.indexOf('--name');
    const emailIndex = args.indexOf('--owner-email');

    if (nameIndex === -1 || !args[nameIndex + 1]) {
      console.error('Error: --name <platform-name> is required');
      process.exit(1);
    }
    if (emailIndex === -1 || !args[emailIndex + 1]) {
      console.error('Error: --owner-email <email> is required');
      process.exit(1);
    }

    const name = args[nameIndex + 1]!;
    const ownerEmail = args[emailIndex + 1]!;

    try {
      const result = await issuePlatformWithApiKey({ name, ownerEmail });
      console.log('=====================================================');
      console.log('   WOWO EXTERNAL API — PLATFORM CREATED');
      console.log('=====================================================');
      console.log(`Platform ID:     ${result.id}`);
      console.log(`Platform Name:   ${result.name}`);
      console.log(`API Key Prefix:  ${result.apiKeyPrefix}...`);
      console.log(`Platform API Key:`);
      console.log(result.apiKey);
      console.log('');
      console.log('Save this API key now. It is stored as a SHA-256 hash');
      console.log('and will NEVER be displayed again.');
      console.log('=====================================================');
    } catch (err) {
      console.error(`Failed to create platform: ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'regenerate-api-key') {
    const platformIndex = args.indexOf('--platform');
    if (platformIndex === -1 || !args[platformIndex + 1]) {
      console.error('Error: --platform <platform-id> is required');
      process.exit(1);
    }

    const platformId = args[platformIndex + 1]!;

    try {
      const result = await rotatePlatformApiKey(platformId);
      console.log('=====================================================');
      console.log(`New API Key for platform ${platformId}:`);
      console.log(result.apiKey);
      console.log('');
      console.log('Save this API key now. It will never be displayed again.');
      console.log('=====================================================');
    } catch (err) {
      console.error(`Failed to regenerate API key: ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'list-platforms') {
    try {
      const platforms = await listPlatforms();
      console.table(
        platforms.map((p) => ({
          id: p.id,
          name: p.name,
          prefix: p.apiKeyPrefix ?? 'none',
          active: p.isActive,
          lastUsedAt: p.apiKeyLastUsedAt?.toISOString() ?? 'never',
          createdAt: p.createdAt.toISOString(),
        }))
      );
    } catch (err) {
      console.error(`Failed to list platforms: ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  console.error('Usage:');
  console.error('  tsx src/cli/platform.ts create-platform --name <name> --owner-email <email>');
  console.error('  tsx src/cli/platform.ts regenerate-api-key --platform <id>');
  console.error('  tsx src/cli/platform.ts list-platforms');
  process.exit(1);
}

if (process.argv[1]?.endsWith('platform.ts') || process.argv[1]?.endsWith('platform.js')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
