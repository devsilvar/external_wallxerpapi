import { prisma } from './src/db/client.js';

async function checkUser() {
  const user = await prisma.user.findUnique({
    where: { email: 'admin@paymytax.ng' },
    select: { id: true, email: true, fullName: true, role: true },
  });
  
  console.log('Admin User:', JSON.stringify(user, null, 2));
  
  await prisma.$disconnect();
}

checkUser();
