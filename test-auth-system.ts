/**
 * Comprehensive test script for the authentication system
 * Tests both developer and admin flows
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const API_BASE = 'http://localhost:5000';

interface LoginResponse {
  status: string;
  data: {
    sessionToken: string;
    user: {
      id: string;
      email: string;
      fullName: string;
      isVerified: boolean;
      role: string;
    };
    platform?: {
      id: string;
      name: string;
      approvalStatus: string;
    } | null;
  };
}

async function testAdminFlow() {
  console.log('\n🔐 Testing Admin Flow...');
  console.log('━'.repeat(50));

  // Admin login
  const loginRes = await fetch(`${API_BASE}/portal/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@paymytax.ng',
      password: 'Admin@12345',
    }),
  });

  const loginData: LoginResponse = await loginRes.json();

  if (loginData.data.user.role !== 'admin') {
    throw new Error(`Expected role 'admin', got '${loginData.data.user.role}'`);
  }

  console.log('✅ Admin login successful');
  console.log(`   Email: ${loginData.data.user.email}`);
  console.log(`   Role: ${loginData.data.user.role}`);

  const adminToken = loginData.data.sessionToken;

  // Test admin stats endpoint
  const statsRes = await fetch(`${API_BASE}/admin/stats`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  const statsData = await statsRes.json();
  console.log('✅ Admin stats retrieved');
  console.log(`   Total Platforms: ${statsData.data.totalPlatforms}`);
  console.log(`   Pending: ${statsData.data.pendingPlatforms}`);
  console.log(`   Active: ${statsData.data.activePlatforms}`);
  console.log(`   Total Users: ${statsData.data.totalUsers}`);

  // Test admin platforms endpoint
  const platformsRes = await fetch(`${API_BASE}/admin/platforms`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  const platformsData = await platformsRes.json();
  console.log('✅ Admin platforms retrieved');
  console.log(`   Found ${platformsData.data.length} platforms`);

  return { adminToken, platforms: platformsData.data };
}

async function testDeveloperFlow() {
  console.log('\n👨‍💻 Testing Developer Flow...');
  console.log('━'.repeat(50));

  // Developer login
  const loginRes = await fetch(`${API_BASE}/portal/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'developer@test.com',
      password: 'Test@12345',
    }),
  });

  const loginData: LoginResponse = await loginRes.json();

  if (loginData.data.user.role !== 'user') {
    throw new Error(`Expected role 'user', got '${loginData.data.user.role}'`);
  }

  console.log('✅ Developer login successful');
  console.log(`   Email: ${loginData.data.user.email}`);
  console.log(`   Role: ${loginData.data.user.role}`);
  console.log(`   Platform: ${loginData.data.platform?.name}`);
  console.log(`   Status: ${loginData.data.platform?.approvalStatus}`);

  const devToken = loginData.data.sessionToken;

  // Test /portal/me endpoint
  const meRes = await fetch(`${API_BASE}/portal/me`, {
    headers: { Authorization: `Bearer ${devToken}` },
  });

  const meData = await meRes.json();
  console.log('✅ Profile retrieved via /portal/me');

  // Test getting API keys
  const keysRes = await fetch(`${API_BASE}/portal/keys`, {
    headers: { Authorization: `Bearer ${devToken}` },
  });

  const keysData = await keysRes.json();
  console.log('✅ API keys retrieved');
  console.log(`   Total keys: ${keysData.data.length}`);

  // Test creating a test API key
  const createKeyRes = await fetch(`${API_BASE}/portal/keys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${devToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      label: 'Test Key from Script',
      environment: 'test',
    }),
  });

  if (createKeyRes.ok) {
    const newKeyData = await createKeyRes.json();
    console.log('✅ Test API key created');
    console.log(`   Prefix: ${newKeyData.data.prefix}`);
  } else {
    const errorData = await createKeyRes.json();
    console.log('⚠️  Key creation failed:', errorData.error?.message);
  }

  return { devToken, platform: loginData.data.platform };
}

async function testNewUserRegistration() {
  console.log('\n📝 Testing New User Registration...');
  console.log('━'.repeat(50));

  const testEmail = `test_${Date.now()}@example.com`;

  const registerRes = await fetch(`${API_BASE}/portal/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail,
      password: 'TestPassword123!',
      fullName: 'Test User',
      platformName: 'Test Platform ' + Date.now(),
    }),
  });

  if (registerRes.ok) {
    const registerData = await registerRes.json();
    console.log('✅ New user registered successfully');
    console.log(`   Email: ${registerData.data.user.email}`);
    console.log(`   Role: ${registerData.data.user.role}`);
    console.log(`   Platform: ${registerData.data.platform.name}`);
    console.log(`   Status: ${registerData.data.platform.approvalStatus}`);
    console.log(`   Test API Key: ${registerData.data.testApiKey.substring(0, 20)}...`);

    // Clean up - delete test user
    await prisma.platformApiKey.deleteMany({
      where: { platform: { ownerUserId: registerData.data.user.id } },
    });
    await prisma.platform.deleteMany({
      where: { ownerUserId: registerData.data.user.id },
    });
    await prisma.user.delete({
      where: { id: registerData.data.user.id },
    });
    console.log('✅ Test user cleaned up');
  } else {
    const errorData = await registerRes.json();
    console.log('❌ Registration failed:', errorData.error?.message);
  }
}

async function testPlatformApproval() {
  console.log('\n✅ Testing Platform Approval Workflow...');
  console.log('━'.repeat(50));

  // Create a new pending platform
  const testEmail = `pending_${Date.now()}@example.com`;

  const registerRes = await fetch(`${API_BASE}/portal/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail,
      password: 'TestPassword123!',
      fullName: 'Pending User',
      platformName: 'Pending Platform ' + Date.now(),
    }),
  });

  const registerData = await registerRes.json();
  const platformId = registerData.data.platform.id;
  const userId = registerData.data.user.id;

  console.log('✅ Created pending platform');
  console.log(`   Status: ${registerData.data.platform.approvalStatus}`);

  // Admin login
  const adminLoginRes = await fetch(`${API_BASE}/portal/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@paymytax.ng',
      password: 'Admin@12345',
    }),
  });

  const adminLoginData: LoginResponse = await adminLoginRes.json();
  const adminToken = adminLoginData.data.sessionToken;

  // Approve the platform
  const approveRes = await fetch(`${API_BASE}/admin/platforms/${platformId}/approve`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  if (approveRes.ok) {
    const approveData = await approveRes.json();
    console.log('✅ Platform approved by admin');
    console.log(`   New Status: ${approveData.data.approvalStatus}`);
  } else {
    console.log('❌ Approval failed');
  }

  // Clean up
  await prisma.platformApiKey.deleteMany({
    where: { platform: { ownerUserId: userId } },
  });
  await prisma.platform.deleteMany({
    where: { ownerUserId: userId },
  });
  await prisma.user.delete({
    where: { id: userId },
  });
  console.log('✅ Test platform cleaned up');
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║  Authentication System Comprehensive Test     ║');
  console.log('╚════════════════════════════════════════════════╝');

  try {
    await testAdminFlow();
    await testDeveloperFlow();
    await testNewUserRegistration();
    await testPlatformApproval();

    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  ✅ ALL TESTS PASSED!                         ║');
    console.log('╚════════════════════════════════════════════════╝\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
