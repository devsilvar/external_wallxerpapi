import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password.js';
import { generateToken, hashToken } from '../src/lib/token.js';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'admin@paymytax.ng';
const ADMIN_PASSWORD = 'Admin@12345';
const DEVELOPER_EMAIL = 'developer@test.com';
const DEVELOPER_PASSWORD = 'Test@12345';

async function main() {
  console.log('🌱 Seeding External API database...\n');

  // Operator admins live in `external_admins`, NOT in the developer `User`
  // table. /admin/auth/login resolves credentials from external_admins only —
  // seeding a User with role 'admin' produces an account that can never log in.
  const adminPasswordHash = await hashPassword(ADMIN_PASSWORD);

  const admin = await prisma.externalAdmin.upsert({
    where: { email: ADMIN_EMAIL },
    update: {
      name: 'PayMyTax Admin',
      passwordHash: adminPasswordHash,
      role: 'admin',
      revokedAt: null,
      expiresAt: null,
    },
    create: {
      name: 'PayMyTax Admin',
      email: ADMIN_EMAIL,
      passwordHash: adminPasswordHash,
      // tokenHash is required + unique; this placeholder operator token is never
      // printed or used. Console login goes through the password, not the token.
      tokenHash: hashToken(generateToken()),
      role: 'admin',
    },
  });

  console.log('✅ Admin console account ready:', admin.email);
  console.log(`   Password: ${ADMIN_PASSWORD}\n`);

  // Developer portal account (separate identity from the admin above).
  const devPasswordHash = await hashPassword(DEVELOPER_PASSWORD);

  const testDev = await prisma.user.upsert({
    where: { email: DEVELOPER_EMAIL },
    update: {
      passwordHash: devPasswordHash,
      role: 'user',
      isVerified: true,
      isActive: true,
    },
    create: {
      email: DEVELOPER_EMAIL,
      passwordHash: devPasswordHash,
      fullName: 'Test Developer',
      role: 'user',
      isVerified: true,
      isActive: true,
    },
  });

  console.log('✅ Developer account ready:', testDev.email);
  console.log(`   Password: ${DEVELOPER_PASSWORD}`);

  const testPlatform = await prisma.platform.upsert({
    where: { ownerUserId: testDev.id },
    update: {
      name: 'Test Platform',
      approvalStatus: 'ACTIVE',
      isActive: true,
    },
    create: {
      name: 'Test Platform',
      ownerUserId: testDev.id,
      approvalStatus: 'ACTIVE',
      isActive: true,
    },
  });

  console.log('✅ Platform ready:', testPlatform.name, '(ACTIVE)\n');
  console.log('🎉 Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
