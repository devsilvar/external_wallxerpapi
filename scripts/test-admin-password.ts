/**
 * Test Admin Password Verification
 * 
 * This script checks if the admin password in the database
 * matches the expected password from the seed script.
 */

import { PrismaClient } from '@prisma/client';
import { verifyPassword } from '../src/lib/password.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Testing Admin Password...\n');

  // Find the admin user
  const admin = await prisma.user.findUnique({
    where: { email: 'admin@paymytax.ng' },
  });

  if (!admin) {
    console.error('❌ Admin user not found!');
    console.log('   Email searched: admin@paymytax.ng');
    console.log('   Make sure seed script has run.');
    process.exit(1);
  }

  console.log('✅ Admin user found:');
  console.log('   ID:', admin.id);
  console.log('   Email:', admin.email);
  console.log('   Name:', admin.fullName);
  console.log('   Role:', admin.role);
  console.log('   Password Hash:', admin.passwordHash?.substring(0, 50) + '...\n');

  if (!admin.passwordHash) {
    console.error('❌ Admin user has no password hash!');
    process.exit(1);
  }

  // Test passwords
  const testPasswords = [
    'Admin@12345',  // Expected correct password
    'Admin@123456', // Wrong (old backend password)
    'admin@12345',  // Wrong (lowercase)
    'Admin@1234',   // Wrong (missing 5)
  ];

  console.log('🧪 Testing passwords:\n');

  for (const password of testPasswords) {
    const isValid = await verifyPassword(password, admin.passwordHash);
    const icon = isValid ? '✅' : '❌';
    console.log(`${icon} Password: "${password}" - ${isValid ? 'CORRECT' : 'incorrect'}`);
  }

  console.log('\n' + '='.repeat(50));
  
  const correctPassword = await verifyPassword('Admin@12345', admin.passwordHash);
  
  if (correctPassword) {
    console.log('✅ SUCCESS: Admin password is correct!');
    console.log('   Email: admin@paymytax.ng');
    console.log('   Password: Admin@12345');
  } else {
    console.log('❌ PROBLEM: Expected password does not match!');
    console.log('   The admin user exists but password verification fails.');
    console.log('   Try running seed script again: npm run seed');
  }
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
