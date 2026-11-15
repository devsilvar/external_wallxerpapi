import { loadConfig } from '../config.js';
import { createAdmin } from '../db/admin.repo.js';
import { issueActivationCodeRecord } from '../db/device.repo.js';
import { generateActivationCode, generateToken, hashToken } from '../lib/token.js';

export interface IssueCodeResult {
  code: string;
  accountId: string;
  expiresAt: Date;
}

export interface SeedAdminResult {
  id: string;
  name: string;
  token: string;
  expiresAt: Date | null;
  allowedIps: string[];
}

/**
 * Issues a single-use 10-character Crockford Base32 activation code for an account.
 * Revokes any half-activated device on that account and stores sha256(code).
 * Never logs the activation code.
 */
export async function issueActivationCode(
  accountId: string,
  ttlHours?: number
): Promise<IssueCodeResult> {
  const config = loadConfig();
  const effectiveTtlHours = ttlHours ?? config.EXTERNAL_CODE_TTL_HOURS;

  const code = generateActivationCode();
  const codeHash = hashToken(code);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + effectiveTtlHours * 3600 * 1000);

  await issueActivationCodeRecord({
    businessId: accountId,
    codeHash,
    expiresAt,
  });

  return {
    code,
    accountId,
    expiresAt,
  };
}

/**
 * Generates and seeds an administrative token (32-byte / 64 hex characters).
 * Stores sha256(token) in external_admins. Never logs the token.
 */
export async function seedAdminToken(params: {
  name: string;
  expiresAt?: Date | null;
  allowedIps?: string[];
}): Promise<SeedAdminResult> {
  const token = generateToken();
  const tokenHash = hashToken(token);

  const admin = await createAdmin({
    name: params.name,
    tokenHash,
    role: 'admin',
    expiresAt: params.expiresAt ?? null,
    allowedIps: params.allowedIps ?? [],
  });

  return {
    id: admin.id,
    name: admin.name,
    token,
    expiresAt: admin.expiresAt,
    allowedIps: admin.allowedIps,
  };
}

// CLI entrypoint
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'seed-admin') {
    const nameIndex = args.indexOf('--name');
    if (nameIndex === -1 || !args[nameIndex + 1]) {
      console.error('Error: --name <admin-name> is required');
      process.exit(1);
    }
    const name = args[nameIndex + 1]!;

    let expiresAt: Date | null = null;
    const expiresIndex = args.indexOf('--expires');
    if (expiresIndex !== -1 && args[expiresIndex + 1]) {
      expiresAt = new Date(args[expiresIndex + 1]!);
      if (isNaN(expiresAt.getTime())) {
        console.error('Error: --expires must be a valid ISO-8601 date');
        process.exit(1);
      }
    }

    let allowedIps: string[] = [];
    const ipsIndex = args.indexOf('--ips');
    if (ipsIndex !== -1 && args[ipsIndex + 1]) {
      allowedIps = args[ipsIndex + 1]!
        .split(',')
        .map((ip) => ip.trim())
        .filter(Boolean);
    }

    try {
      const result = await seedAdminToken({ name, expiresAt, allowedIps });
      console.log(`Admin token created for '${result.name}':`);
      console.log(result.token);
      console.log(`ID:         ${result.id}`);
      console.log(`Expires at: ${result.expiresAt ? result.expiresAt.toISOString() : 'Never'}`);
      console.log(`Allowlist:  ${result.allowedIps.length > 0 ? result.allowedIps.join(', ') : 'All IPs'}`);
      console.log('Save this token now. It will never be displayed again.');
    } catch (err) {
      console.error(`Failed to seed admin: ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'issue-code') {
    const accountIndex = args.indexOf('--account');
    if (accountIndex === -1) {
      console.error('Error: --account <business-id> is required');
      process.exit(1);
    }

    const accountId = args[accountIndex + 1];
    if (!accountId || accountId.startsWith('--')) {
      console.error('Error: --account requires a valid business ID');
      process.exit(1);
    }

    try {
      const result = await issueActivationCode(accountId);
      console.log(`Activation code for account ${result.accountId}:`);
      console.log(result.code);
      console.log(`Expires at: ${result.expiresAt.toISOString()}`);
    } catch (err) {
      console.error(`Failed to issue activation code: ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  console.error(`Usage:`);
  console.error(`  tsx src/cli/admin.ts issue-code --account <business-id>`);
  console.error(`  tsx src/cli/admin.ts seed-admin --name <admin-name> [--expires <date>] [--ips <list>]`);
  process.exit(1);
}

// Run CLI if invoked directly
if (process.argv[1]?.endsWith('admin.ts') || process.argv[1]?.endsWith('admin.js')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
