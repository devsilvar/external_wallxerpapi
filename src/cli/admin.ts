import { createAdmin, findAdminByEmail, setAdminCredentials } from '../db/admin.repo.js';
import { hashPassword } from '../lib/password.js';
import { generateToken, hashToken } from '../lib/token.js';

export interface SeedAdminResult {
id: string;
name: string;
email: string | null;
token: string;
expiresAt: Date | null;
allowedIps: string[];
}

/**
 * Generates and seeds an administrative account (32-byte / 64 hex characters).
 * Stores sha256(token) in external_admins. Never logs the token.
 *
 * Supplying --email/--password gives the operator a console login. Admins are a
 * separate identity from developer accounts: an admin email must not collide
 * with a developer User, and setting one does not create a developer account.
 */
export async function seedAdminToken(params: {
name: string;
email?: string | null;
password?: string | null;
expiresAt?: Date | null;
allowedIps?: string[];
}): Promise<SeedAdminResult> {
const token = generateToken();
const tokenHash = hashToken(token);

const admin = await createAdmin({
name: params.name,
tokenHash,
email: params.email ?? null,
passwordHash: params.password ? await hashPassword(params.password) : null,
role: 'admin',
expiresAt: params.expiresAt ?? null,
allowedIps: params.allowedIps ?? [],
});

return {
id: admin.id,
name: admin.name,
email: admin.email,
token,
expiresAt: admin.expiresAt,
allowedIps: admin.allowedIps,
};
}

/**
 * Sets (or resets) the console password for an existing admin, looked up by
 * email. Used to give operator-token-only admins a login, or to rotate one.
 */
export async function setAdminPassword(params: {
email: string;
password: string;
}): Promise<{ id: string; name: string; email: string }> {
const existing = await findAdminByEmail(params.email);
if (!existing) {
throw new Error(`No admin found with email '${params.email}'`);
}

const updated = await setAdminCredentials(existing.id, {
email: params.email,
passwordHash: await hashPassword(params.password),
});

return {
id: updated.id,
name: updated.name,
email: updated.email ?? params.email.trim().toLowerCase(),
};
}

function readFlag(args: string[], flag: string): string | null {
const index = args.indexOf(flag);
if (index === -1) return null;
const value = args[index + 1];
if (!value || value.startsWith('--')) return null;
return value;
}

// CLI entrypoint
async function main(): Promise<void> {
const args = process.argv.slice(2);
const command = args[0];

if (command === 'seed-admin') {
const name = readFlag(args, '--name');
if (!name) {
console.error('Error: --name <admin-name> is required');
process.exit(1);
}

const email = readFlag(args, '--email');
const password = readFlag(args, '--password');

if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
console.error('Error: --email must be a valid email address');
process.exit(1);
}
if (password && password.length < 8) {
console.error('Error: --password must be at least 8 characters');
process.exit(1);
}
if (email && !password) {
console.error('Error: --email requires --password so the account can be used');
process.exit(1);
}

let expiresAt: Date | null = null;
const expiresRaw = readFlag(args, '--expires');
if (expiresRaw) {
expiresAt = new Date(expiresRaw);
if (isNaN(expiresAt.getTime())) {
console.error('Error: --expires must be a valid ISO-8601 date');
process.exit(1);
}
}

const ipsRaw = readFlag(args, '--ips');
const allowedIps: string[] = ipsRaw
? ipsRaw
.split(',')
.map((ip) => ip.trim())
.filter(Boolean)
: [];

try {
const result = await seedAdminToken({ name, email, password, expiresAt, allowedIps });
console.log(`Admin created for '${result.name}':`);
console.log(`ID: ${result.id}`);
console.log(`Email: ${result.email ?? '(none - token only, cannot log in to the console)'}`);
console.log(`Expires at: ${result.expiresAt ? result.expiresAt.toISOString() : 'Never'}`);
console.log(`Allowlist: ${result.allowedIps.length > 0 ? result.allowedIps.join(', ') : 'All IPs'}`);
console.log('');
console.log(`Operator token: ${result.token}`);
console.log('Save this token now. It will never be displayed again.');
} catch (err) {
console.error(`Failed to seed admin: ${(err as Error).message}`);
process.exit(1);
}
return;
}

if (command === 'set-admin-password') {
const email = readFlag(args, '--email');
const password = readFlag(args, '--password');

if (!email || !password) {
console.error('Error: --email <email> and --password <password> are required');
process.exit(1);
}
if (password.length < 8) {
console.error('Error: --password must be at least 8 characters');
process.exit(1);
}

try {
const result = await setAdminPassword({ email, password });
console.log(`Password updated for admin '${result.name}' (${result.email}).`);
console.log('Existing console sessions stay valid until they expire or are logged out.');
} catch (err) {
console.error(`Failed to set admin password: ${(err as Error).message}`);
process.exit(1);
}
return;
}

console.error(`Usage:`);
console.error(` tsx src/cli/admin.ts seed-admin --name <admin-name> [--email <email> --password <password>] [--expires <date>] [--ips <list>]`);
console.error(` tsx src/cli/admin.ts set-admin-password --email <email> --password <password>`);
process.exit(1);
}

// Run CLI if invoked directly
if (process.argv[1]?.endsWith('admin.ts') || process.argv[1]?.endsWith('admin.js')) {
main().catch((err) => {
console.error(err);
process.exit(1);
});
}
