/**
 * Reset Admin Password
 * 
 * This script resets the admin password to the default from seed.
 * Use this if login fails but the user exists.
 */

import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🔐 Resetting Admin Password...\n');

  // Find the admin user
  const existingAdmin = await prisma.user.findUnique({
    where: { email: 'admin@paymytax.ng' },
  });

  if (!existingAdmin) {
    console.error('❌ Admin user not found!');
    console.log('   Email searched: admin@paymytax.ng');
    console.log('   Run seed script first: npm run seed');
    process.exit(1);
  }

  console.log('✅ Found admin user:');
  console.log('   ID:', existingAdmin.id);
  console.log('   Email:', existingAdmin.email);
  console.log('   Name:', existingAdmin.fullName);
  console.log('   Role:', existingAdmin.role);
  console.log();

  // Hash the new password
  const newPassword = 'Admin@12345';
  console.log('🔨 Hashing new password...');
  const passwordHash = await hashPassword(newPassword);
  console.log('✅ Password hashed successfully\n');

  // Update the user
  console.log('💾 Updating admin user in database...');
  await prisma.user.update({
    where: { email: 'admin@paymytax.ng' },
    data: {
      passwordHash,
      isActive: true,
      isVerified: true,
    },
  });

  console.log('✅ Admin password reset successfully!\n');
  console.log('='.repeat(50));
  console.log('📋 Updated Admin Credentials:');
  console.log('   Email:    admin@paymytax.ng');
  console.log('   Password: Admin@12345');
  console.log('='.repeat(50));
  console.log('\n🎉 You can now login with these credentials!');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
