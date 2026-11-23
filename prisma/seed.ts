import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding External API database...\n');

  // Create admin user for approving API key requests
  const adminPassword = await hashPassword('Admin@12345');
  
  const admin = await prisma.user.upsert({
    where: { email: 'admin@paymytax.ng' },
    update: {
      passwordHash: adminPassword,
      role: 'admin',
      isVerified: true,
      isActive: true,
    },
    create: {
      email: 'admin@paymytax.ng',
      passwordHash: adminPassword,
      fullName: 'PayMyTax Admin',
      role: 'admin',
      isVerified: true,
      isActive: true,
    },
  });

  console.log('✅ Created admin user:', admin.email);
  console.log('   Password: Admin@12345\n');

  // Create test developer account with platform
  const devPassword = await hashPassword('Test@12345');
  
  const testDev = await prisma.user.upsert({
    where: { email: 'developer@test.com' },
    update: {
      passwordHash: devPassword,
      role: 'user',
      isVerified: true,
      isActive: true,
    },
    create: {
      email: 'developer@test.com',
      passwordHash: devPassword,
      fullName: 'Test Developer',
      role: 'user',
      isVerified: true,
      isActive: true,
    },
  });

  console.log('✅ Created test developer:', testDev.email);
  console.log('   Password: Test@12345');

  // Create platform for test developer
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

  console.log('✅ Created test platform:', testPlatform.name);
  console.log('   Status: ACTIVE (Pre-approved)\n');

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
