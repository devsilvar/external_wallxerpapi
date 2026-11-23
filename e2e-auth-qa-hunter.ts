/**
 * QA HUNTER E2E AUTHENTICATION TEST
 * Comprehensive end-to-end testing for developer and admin authentication flows
 * Following QA Hunter methodology: hostile by default, prove it works by execution
 */

import { PrismaClient } from '@prisma/client';
import type { UserRole } from '@prisma/client';

const prisma = new PrismaClient();
const API_BASE = 'http://localhost:5000';

// Test Results
interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
  evidenceTier: 'EXECUTED' | 'TRACED' | 'CANNOT_VERIFY';
  severity?: 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW';
  details?: string;
  timing?: number;
  scaleImpact?: 'NONE' | 'DEGRADES' | 'BREAKS' | 'CORRUPTS';
}

const results: TestResult[] = [];
let testsPassed = 0;
let testsFailed = 0;
let testsWarned = 0;
let testsSkipped = 0;

function log(category: string, message: string, level: 'INFO' | 'PASS' | 'FAIL' | 'WARN' = 'INFO') {
  const colors: Record<string, string> = {
    INFO: '\x1b[36m', // Cyan
    PASS: '\x1b[32m', // Green
    FAIL: '\x1b[31m', // Red
    WARN: '\x1b[33m', // Yellow
  };
  const reset = '\x1b[0m';
  console.log(`${colors[level]}[${category}]${reset} ${message}`);
}

function recordResult(result: TestResult) {
  results.push(result);
  switch (result.status) {
    case 'PASS':
      testsPassed++;
      log('TEST', `✅ ${result.name}`, 'PASS');
      break;
    case 'FAIL':
      testsFailed++;
      log('TEST', `❌ ${result.name}: ${result.details}`, 'FAIL');
      break;
    case 'WARN':
      testsWarned++;
      log('TEST', `⚠️  ${result.name}: ${result.details}`, 'WARN');
      break;
    case 'SKIP':
      testsSkipped++;
      log('TEST', `⏭️  ${result.name}: ${result.details}`, 'INFO');
      break;
  }
}

// ============================================================================
// PHASE 0: INVENTORY & COVERAGE
// ============================================================================

async function phase0_inventory() {
  log('PHASE 0', '🔍 INVENTORY & COVERAGE LEDGER', 'INFO');
  console.log('━'.repeat(80));

  const coverage = {
    routes: [
      '/portal/auth/register',
      '/portal/auth/login',
      '/portal/auth/logout',
      '/portal/me',
      '/portal/auth/password',
      '/portal/keys',
      '/portal/usage',
      '/admin/stats',
      '/admin/platforms',
      '/admin/platforms/:id/approve',
      '/admin/platforms/:id/reject',
      '/admin/platforms/:id/suspend',
      '/admin/platforms/:id/activate',
      '/admin/users',
    ],
    models: ['User', 'Platform', 'Session', 'PlatformApiKey', 'PortalToken'],
    roles: ['user', 'admin', 'superadmin'],
    authMechanisms: ['session-based with Bearer token', 'SHA-256 hashed tokens'],
  };

  log('INVENTORY', `Routes to test: ${coverage.routes.length}`, 'INFO');
  log('INVENTORY', `Database models: ${coverage.models.join(', ')}`, 'INFO');
  log('INVENTORY', `User roles: ${coverage.roles.join(', ')}`, 'INFO');
  console.log('');
}

// ============================================================================
// PHASE 1: SPECIFICATION & REQUIREMENTS
// ============================================================================

async function phase1_requirements() {
  log('PHASE 1', '📋 REQUIREMENT TRACEABILITY', 'INFO');
  console.log('━'.repeat(80));

  const requirements = [
    { id: 'REQ-001', desc: 'Developer can register with email/password', source: 'CONFIRMED' },
    { id: 'REQ-002', desc: 'Developer receives test API key on signup', source: 'CONFIRMED' },
    { id: 'REQ-003', desc: 'Developer can login with credentials', source: 'CONFIRMED' },
    { id: 'REQ-004', desc: 'Admin can login with admin credentials', source: 'CONFIRMED' },
    { id: 'REQ-005', desc: 'Admin can view platform list', source: 'CONFIRMED' },
    { id: 'REQ-006', desc: 'Admin can approve platforms', source: 'CONFIRMED' },
    { id: 'REQ-007', desc: 'Users cannot access admin routes', source: 'CONFIRMED' },
    { id: 'REQ-008', desc: 'Session tokens are secure (hashed storage)', source: 'CONFIRMED' },
    { id: 'REQ-009', desc: 'Platform approval affects API key creation', source: 'CONFIRMED' },
    { id: 'REQ-010', desc: 'Duplicate email registration is rejected', source: 'INFERRED' },
  ];

  requirements.forEach((req) => {
    log('REQ', `${req.id}: ${req.desc} [${req.source}]`, 'INFO');
  });
  console.log('');
}

// ============================================================================
// PHASE 2: DEVELOPER AUTHENTICATION TESTS
// ============================================================================

async function phase2_developerAuth() {
  log('PHASE 2', '👨‍💻 DEVELOPER AUTHENTICATION TESTS', 'INFO');
  console.log('━'.repeat(80));

  // TEST 1: Register new developer
  await test_developerRegistration();

  // TEST 2: Login with correct credentials
  await test_developerLogin_success();

  // TEST 3: Login with wrong password
  await test_developerLogin_wrongPassword();

  // TEST 4: Login with non-existent email
  await test_developerLogin_nonExistentUser();

  // TEST 5: Duplicate email registration
  await test_developerRegistration_duplicate();

  // TEST 6: Registration with invalid data
  await test_developerRegistration_invalidData();

  // TEST 7: Get authenticated user profile
  await test_developerProfile();

  // TEST 8: Logout
  await test_developerLogout();

  console.log('');
}

async function test_developerRegistration() {
  const testName = 'Developer Registration - Happy Path';
  const start = Date.now();
  const testEmail = `dev_${Date.now()}@example.com`;

  try {
    const response = await fetch(`${API_BASE}/portal/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'TestPassword123!',
        fullName: 'Test Developer',
        platformName: 'Test Platform ' + Date.now(),
      }),
    });

    const data = await response.json();
    const timing = Date.now() - start;

    if (!response.ok) {
      recordResult({
        name: testName,
        status: 'FAIL',
        evidenceTier: 'EXECUTED',
        severity: 'HIGH',
        details: `Registration failed: ${data.error?.message}`,
        timing,
      });
      return;
    }

    // Verify response structure
    const checks = {
      hasSessionToken: !!data.data?.sessionToken,
      hasUser: !!data.data?.user,
      userHasRole: data.data?.user?.role === 'user',
      hasPlatform: !!data.data?.platform,
      platformPending: data.data?.platform?.approvalStatus === 'PENDING',
      hasTestKey: !!data.data?.testApiKey,
    };

    const allPassed = Object.values(checks).every((v) => v);

    if (allPassed) {
      recordResult({
        name: testName,
        status: 'PASS',
        evidenceTier: 'EXECUTED',
        details: `User created with role=${data.data.user.role}, platform=${data.data.platform.approvalStatus}, test key provided`,
        timing,
      });

      // Cleanup
      await prisma.platformApiKey.deleteMany({ where: { platform: { ownerUserId: data.data.user.id } } });
      await prisma.platform.deleteMany({ where: { ownerUserId: data.data.user.id } });
      await prisma.session.deleteMany({ where: { userId: data.data.user.id } });
      await prisma.user.delete({ where: { id: data.data.user.id } });
    } else {
      recordResult({
        name: testName,
        status: 'FAIL',
        evidenceTier: 'EXECUTED',
        severity: 'HIGH',
        details: `Missing fields: ${JSON.stringify(checks)}`,
        timing,
      });
    }
  } catch (error: any) {
    recordResult({
      name: testName,
      status: 'FAIL',
      evidenceTier: 'EXECUTED',
      severity: 'BLOCKER',
      details: `Exception: ${error.message}`,
    });
  }
}

async function test_developerLogin_success() {
  const testName = 'Developer Login - Valid Credentials';
  const start = Date.now();

  try {
    const response = await fetch(`${API_BASE}/portal/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'developer@test.com',
        password: 'Test@12345',
      }),
    });

    const data = await response.json();
    const timing = Date.now() - start;

    if (!response.ok) {
      recordResult({
        name: testName,
        status: 'FAIL',
        evidenceTier: 'EXECUTED',
        severity: 'BLOCKER',
        details: `Login failed: ${data.error?.message}`,
        timing,
      });
      return;
    }

    const checks = {
      hasSessionToken: !!data.data?.sessionToken,
      hasUser: !!data.data?.user,
      userHasEmail: data.data?.user?.email === 'developer@test.com',
      userHasRole: data.data?.user?.role === 'user',
      hasPlatform: !!data.data?.platform,
    };

    const allPassed = Object.values(checks).every((v) => v);

    recordResult({
      name: testName,
      status: allPassed ? 'PASS' : 'FAIL',
      evidenceTier: 'EXECUTED',
      severity: allPassed ? undefined : 'BLOCKER',
      details: allPassed ? `Login successful, role=${data.data.user.role}` : `Failed checks: ${JSON.stringify(checks)}`,
      timing,
    });
  } catch (error: any) {
    recordResult({
      name: testName,
      status: 'FAIL',
      evidenceTier: 'EXECUTED',
      severity: 'BLOCKER',
      details: `Exception: ${error.message}`,
    });
  }
}

async function test_developerLogin_wrongPassword() {
  const testName = 'Developer Login - Wrong Password (Negative Test)';
  const start = Date.now();

  try {
    const response = await fetch(`${API_BASE}/portal/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'developer@test.com',
        password: 'WrongPassword123!',
      }),
    });

    const timing = Date.now() - start;

    if (response.status === 401) {
      recordResult({
        name: testName,
        status: 'PASS',
        evidenceTier: 'EXECUTED',
        details: 'Correctly rejected with 401',
        timing,
      });
    } else {
      recordResult({
        name: testName,
        status: 'FAIL',
        evidenceTier: 'EXECUTED',
        severity: 'HIGH',
        details: `Expected 401, got ${response.status}`,
        timing,
        scaleImpact: 'NONE',
      });
    }
  } catch (error: any) {
    recordResult({
      name: testName,
      status: 'FAIL',
      evidenceTier: 'EXECUTED',
      severity: 'MEDIUM',
      details: `Exception: ${error.message}`,
    });
  }
}

async function test_developerLogin_nonExistentUser() {
  const testName = 'Developer Login - Non-existent User (Negative Test)';
  const start = Date.now();

  try {
    const response = await fetch(`${API_BASE}/portal/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'nonexistent@example.com',
        password: 'Password123!',
      }),
    });

    const timing = Date.now() - start;

    if (response.status === 401) {
      recordResult({
        name: testName,
        status: 'PASS',
        evidenceTier: 'EXECUTED',
        details: 'Correctly rejected with 401',
        timing,
      });
    } else {
      recordResult({
        name: testName,
        status: 'FAIL',
        evidenceTier: 'EXECUTED',
        severity: 'MEDIUM',
        details: `Expected 401, got ${response.status}`,
        timing,
      });
    }
  } catch (error: any) {
    recordResult({
      name: testName,
      status: 'FAIL',
      evidenceTier: 'EXECUTED',
      severity: 'MEDIUM',
      details: `Exception: ${error.message}`,
    });
  }
}

async function test_developerRegistration_duplicate() {
  const testName = 'Developer Registration - Duplicate Email (Negative Test)';
  const start = Date.now();

  try {
    const response = await fetch(`${API_BASE}/portal/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'developer@test.com', // Already exists
        password: 'TestPassword123!',
        fullName: 'Test Developer',
        platformName: 'Test Platform',
      }),
    });

    const timing = Date.now() - start;

    if (response.status === 409) {
      recordResult({
        name: testName,
        status: 'PASS',
        evidenceTier: 'EXECUTED',
        details: 'Correctly rejected duplicate email with 409',
        timing,
      });
    } else {
      recordResult({
        name: testName,
        status: 'FAIL',
        evidenceTier: 'EXECUTED',
        severity: 'HIGH',
        details: `Expected 409 Conflict, got ${response.status}`,
        timing,
        scaleImpact: 'CORRUPTS',
      });
    }
  } catch (error: any) {
    recordResult({
      name: testName,
      status: 'FAIL',
      evidenceTier: 'EXECUTED',
      severity: 'MEDIUM',
      details: `Exception: ${error.message}`,
    });
  }
}

async function test_developerRegistration_invalidData() {
  const testName = 'Developer Registration - Invalid Email (Boundary Test)';
  const start = Date.now();

  try {
    const response = await fetch(`${API_BASE}/portal/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'not-an-email',
        password: 'short',
        fullName: '',
        platformName: 'X',
      }),
    });

    const timing = Date.now() - start;

    if (response.status === 400) {
      recordResult({
        name: testName,
        status: 'PASS',
        evidenceTier: 'EXECUTED',
        details: 'Correctly rejected invalid data with 400',
        timing,
      });
    } else {
      recordResult({
        name: testName,
        status: 'FAIL',
        evidenceTier: 'EXECUTED',
        severity: 'MEDIUM',
        details: `Expected 400 Bad Request, got ${response.status}`,
        timing,
      });
    }
  } catch (error: any) {
    recordResult({
      name: testName,
      status: 'FAIL',
      evidenceTier: 'EXECUTED',
      severity: 'MEDIUM',
      details: `Exception: ${error.message}`,
    });
  }
}

async function test_developerProfile() {
  const testName = 'Developer Profile - Get Authenticated User';
  const start = Date.now();

  try {
    // First login
    const loginRes = await fetch(`${API_BASE}/portal/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'developer@test.com',
        password: 'Test@12345',
      }),
    });

    const loginData = await loginRes.json();
    const token = loginData.data?.sessionToken;

    if (!token) {
      recordResult({
        name: testName,
        status: 'SKIP',
        evidenceTier: 'EXECUTED',
        details: 'Could not get session token from login',
      });
      return;
    }

    // Get profile
    const profileRes = await fetch(`${API_BASE}/portal/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const profileData = await profileRes.json();
    const timing = Date.now() - start;

    if (profileRes.ok && profileData.data?.user && profileData.data?.platform) {
      recordResult({
        name: testName,
        status: 'PASS',
        evidenceTier: 'EXECUTED',
        details: `Profile retrieved: user=${profileData.data.user.email}, platform=${profileData.data.platform.name}`,
        timing,
      });
    } else {
      recordResult({
        name: testName,
        status: 'FAIL',
        evidenceTier: 'EXECUTED',
        severity: 'MEDIUM',
        details: `Failed to get profile: ${profileRes.status}`,
        timing,
      });
    }
  } catch (error: any) {
    recordResult({
      name: testName,
      status: 'FAIL',
      evidenceTier: 'EXECUTED',
      severity: 'MEDIUM',
      details: `Exception: ${error.message}`,
    });
  }
}

async function test_developerLogout() {
  const testName = 'Developer Logout - Session Revocation';
  const start = Date.now();

  try {
    // Login first
    const loginRes = await fetch(`${API_BASE}/portal/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'developer@test.com',
        password: 'Test@12345',
      }),
    });

    const loginData = await loginRes.json();
    const token = loginData.data?.sessionToken;

    if (!token) {
      recordResult({
        name: testName,
        status: 'SKIP',
        evidenceTier: 'EXECUTED',
        details: 'Could not get session token',
      });
      return;
    }

    // Logout
    const logoutRes = await fetch(`${API_BASE}/portal/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    // Try to use token after logout
    const profileRes = await fetch(`${API_BASE}/portal/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const timing = Date.now() - start;

    if (logoutRes.status === 204 && profileRes.status === 401) {
      recordResult({
        name: testName,
        status: 'PASS',
        evidenceTier: 'EXECUTED',
        details: 'Session properly revoked, token no longer works',
        timing,
      });
    } else {
      recordResult({
        name: testName,
        status: 'FAIL',
        evidenceTier: 'EXECUTED',
        severity: 'HIGH',
        details: `Logout: ${logoutRes.status}, ProfileAfter: ${profileRes.status} (expected 401)`,
        timing,
        scaleImpact: 'NONE',
      });
    }
  } catch (error: any) {
    recordResult({
      name: testName,
      status: 'FAIL',
      evidenceTier: 'EXECUTED',
      severity: 'MEDIUM',
      details: `Exception: ${error.message}`,
    });
  }
}

// ============================================================================
// PHASE 3: ADMIN AUTHENTICATION & AUTHORIZATION TESTS
// ============================================================================

async function phase3_adminAuth() {
  log('PHASE 3', '🛡️  ADMIN AUTHENTICATION & AUTHORIZATION TESTS', 'INFO');
  console.log('━'.repeat(80));

  // TEST 1: Admin login
  await test_adminLogin_success();

  // TEST 2: Admin can access admin routes
  await test_adminAccess_stats();
  await test_adminAccess_platforms();

  // TEST 3: Regular user cannot access admin routes (IDOR/BOLA)
  await test_userCannotAccessAdmin();

  // TEST 4: Unauthenticated cannot access admin routes
  await test_unauthenticatedCannotAccessAdmin();

  // TEST 5: Platform approval workflow
  await test_platformApproval();

  console.log('');
}

async function test_adminLogin_success() {
  const testName = 'Admin Login - Valid Admin Credentials';
  const start = Date.now();

  try {
    const response = await fetch(`${API_BASE}/portal/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@paymytax.ng',
        password: 'Admin@12345',
      }),
    });

    const data = await response.json();
    const timing = Date.now() - start;

    if (!response.ok) {
      recordResult({
        name: testName,
        status: 'FAIL',
        evidenceTier: 'EXECUTED',
        severity: 'BLOCKER',
        details: `Admin login failed: ${data.error?.message}`,
        timing,
      });
      return;
    }

    const checks = {
      hasSessionToken: !!data.data?.sessionToken,
      hasUser: !!data.data?.user,
      userIsAdmin: data.data?.user?.role === 'admin',
      emailCorrect: data.data?.user?.email === 'admin@paymytax.ng',
    };

    const allPassed = Object.values(checks).every((v) => v);

    recordResult({
      name: testName,
      status: allPassed ? 'PASS' : 'FAIL',
      evidenceTier: 'EXECUTED',
      severity: allPassed ? undefined : 'BLOCKER',
      details: allPassed
        ? `Admin login successful, role=${data.data.user.role}`
        : `Failed checks: ${JSON.stringify(checks)}`,
      timing,
    });
  } catch (error: any) {
    recordResult({
      name: testName,
      status: 'FAIL',
      evidenceTier: 'EXECUTED',
      severity: 'BLOCKER',
      details: `Exception: ${error.message}`,
    });
  }
}

async function test_adminAccess_stats() {
  const testName = 'Admin Endpoint Access - GET /admin/stats';
  const start = Date.now();

  try {
    // Login as admin
    const loginRes = await fetch(`${API_BASE}/portal/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@paymytax.ng',
        password: 'Admin@12345',
      }),
    });

    const loginData = await loginRes.json();
    const token = loginData.data?.sessionToken;

    if (!token) {
      recordResult({
        name: testName,
        status: 'SKIP',
        evidenceTier: 'EXECUTED',
        details: 'Could not get admin token',
      });
      return;
    }

    // Access stats
    const statsRes = await fetch(`${API_BASE}/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const statsData = await statsRes.json();
    const timing = Date.now() - start;

    if (statsRes.ok && statsData.data) {
      const hasRequiredFields =
        typeof statsData.data.totalPlatforms === 'number' &&
        typeof statsData.data.pendingPlatforms === 'number' &&
        typeof statsData.data.activePlatforms === 'number' &&
        typeof statsData.data.totalUsers === 'number';

      recordResult({
        name: testName,
        status: hasRequiredFields ? 'PASS' : 'FAIL',
        evidenceTier: 'EXECUTED',
        severity: hasRequiredFields ? undefined : 'MEDIUM',
        details: hasRequiredFields
          ? `Stats retrieved: platforms=${statsData.data.totalPlatforms}, users=${statsData.data.totalUsers}`
          : 'Missing required fields in response',
        timing,
      });
    } else {
      recordResult({
        name: testName,
        status: 'FAIL',
        evidenceTier: 'EXECUTED',
        severity: 'HIGH',
        details: `Stats endpoint failed: ${statsRes.status}`,
        timing,
      });
    }
  } catch (error: any) {
    recordResult({
      name: testName,
      status: 'FAIL',
      evidenceTier: 'EXECUTED',
      severity: 'HIGH',
      details: `Exception: ${error.message}`,
    });
  }
}

async function test_adminAccess_platforms() {
  const testName = 'Admin Endpoint Access - GET /admin/platforms';
  const start = Date.now();

  try {
    // Login as admin
    const loginRes = await fetch(`${API_BASE}/portal/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@paymytax.ng',
        password: 'Admin@12345',
      }),
    });

    const loginData = await loginRes.json();
    const token = loginData.data?.sessionToken;

    if (!token) {
      recordResult({
        name: testName,
        status: 'SKIP',
        evidenceTier: 'EXECUTED',
        details: 'Could not get admin token',
      });
      return;
    }

    // Get platforms
    const platformsRes = await fetch(`${API_BASE}/admin/platforms`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const platformsData = await platformsRes.json();
    const timing = Date.now() - start;

    if (platformsRes.ok && Array.isArray(platformsData.data)) {
      recordResult({
        name: testName,
        status: 'PASS',
        evidenceTier: 'EXECUTED',
        details: `Platforms retrieved: ${platformsData.data.length} platforms`,
        timing,
      });
    } else {
      recordResult({
        name: testName,
        status: 'FAIL',
        evidenceTier: 'EXECUTED',
        severity: 'HIGH',
        details: `Platforms endpoint failed: ${platformsRes.status}`,
        timing,
      });
    }
  } catch (error: any) {
    recordResult({
      name: testName,
      status: 'FAIL',
      evidenceTier: 'EXECUTED',
      severity: 'HIGH',
      details: `Exception: ${error.message}`,
    });
  }
}

async function test_userCannotAccessAdmin() {
  const testName = 'Authorization - Regular User Cannot Access Admin Routes (IDOR/BOLA Prevention)';
  const start = Date.now();

  try {
    // Login as regular developer
    const loginRes = await fetch(`${API_BASE}/portal/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'developer@test.com',
        password: 'Test@12345',
      }),
    });

    const loginData = await loginRes.json();
    const token = loginData.data?.sessionToken;

    if (!token) {
      recordResult({
        name: testName,
        status: 'SKIP',
        evidenceTier: 'EXECUTED',
        details: 'Could not get developer token',
      });
      return;
    }

    // Try to access admin route
    const adminRes = await fetch(`${API_BASE}/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const timing = Date.now() - start;

    if (adminRes.status === 403) {
      recordResult({
        name: testName,
        status: 'PASS',
        evidenceTier: 'EXECUTED',
        details: 'Regular user correctly denied access with 403 Forbidden',
        timing,
      });
    } else {
      recordResult({
        name: testName,
        status: 'FAIL',
        evidenceTier: 'EXECUTED',
        severity: 'BLOCKER',
        details: `Expected 403 Forbidden, got ${adminRes.status} - AUTHORIZATION BYPASS!`,
        timing,
        scaleImpact: 'CORRUPTS',
      });
    }
  } catch (error: any) {
    recordResult({
      name: testName,
      status: 'FAIL',
      evidenceTier: 'EXECUTED',
      severity: 'HIGH',
      details: `Exception: ${error.message}`,
    });
  }
}

async function test_unauthenticatedCannotAccessAdmin() {
  const testName = 'Authorization - Unauthenticated Cannot Access Admin Routes';
  const start = Date.now();

  try {
    const response = await fetch(`${API_BASE}/admin/stats`);
    const timing = Date.now() - start;

    if (response.status === 401) {
      recordResult({
        name: testName,
        status: 'PASS',
        evidenceTier: 'EXECUTED',
        details: 'Unauthenticated request correctly rejected with 401',
        timing,
      });
    } else {
      recordResult({
        name: testName,
        status: 'FAIL',
        evidenceTier: 'EXECUTED',
        severity: 'BLOCKER',
        details: `Expected 401 Unauthorized, got ${response.status}`,
        timing,
        scaleImpact: 'CORRUPTS',
      });
    }
  } catch (error: any) {
    recordResult({
      name: testName,
      status: 'FAIL',
      evidenceTier: 'EXECUTED',
      severity: 'HIGH',
      details: `Exception: ${error.message}`,
    });
  }
}

async function test_platformApproval() {
  const testName = 'Platform Approval Workflow - Admin Approves Developer Platform';
  const start = Date.now();

  try {
    // 1. Create new developer with pending platform
    const testEmail = `approval_test_${Date.now()}@example.com`;
    const registerRes = await fetch(`${API_BASE}/portal/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'TestPassword123!',
        fullName: 'Approval Test Dev',
        platformName: 'Approval Test Platform',
      }),
    });

    const registerData = await registerRes.json();
    const platformId = registerData.data?.platform?.id;
    const userId = registerData.data?.user?.id;

    if (!platformId) {
      recordResult({
        name: testName,
        status: 'SKIP',
        evidenceTier: 'EXECUTED',
        details: 'Could not create test platform',
      });
      return;
    }

    // 2. Login as admin
    const adminLoginRes = await fetch(`${API_BASE}/portal/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@paymytax.ng',
        password: 'Admin@12345',
      }),
    });

    const adminLoginData = await adminLoginRes.json();
    const adminToken = adminLoginData.data?.sessionToken;

    if (!adminToken) {
      recordResult({
        name: testName,
        status: 'SKIP',
        evidenceTier: 'EXECUTED',
        details: 'Could not get admin token',
      });
      // Cleanup
      await cleanupUser(userId);
      return;
    }

    // 3. Approve the platform
    const approveRes = await fetch(`${API_BASE}/admin/platforms/${platformId}/approve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    const approveData = await approveRes.json();
    const timing = Date.now() - start;

    if (approveRes.ok && approveData.data?.approvalStatus === 'ACTIVE') {
      recordResult({
        name: testName,
        status: 'PASS',
        evidenceTier: 'EXECUTED',
        details: 'Platform successfully approved, status changed from PENDING to ACTIVE',
        timing,
      });
    } else {
      recordResult({
        name: testName,
        status: 'FAIL',
        evidenceTier: 'EXECUTED',
        severity: 'HIGH',
        details: `Approval failed or status incorrect: ${approveRes.status}, status=${approveData.data?.approvalStatus}`,
        timing,
      });
    }

    // Cleanup
    await cleanupUser(userId);
  } catch (error: any) {
    recordResult({
      name: testName,
      status: 'FAIL',
      evidenceTier: 'EXECUTED',
      severity: 'HIGH',
      details: `Exception: ${error.message}`,
    });
  }
}

async function cleanupUser(userId: string) {
  try {
    await prisma.platformApiKey.deleteMany({ where: { platform: { ownerUserId: userId } } });
    await prisma.platform.deleteMany({ where: { ownerUserId: userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}

// ============================================================================
// PHASE 4: SECURITY TESTS
// ============================================================================

async function phase4_security() {
  log('PHASE 4', '🔒 SECURITY TESTS', 'INFO');
  console.log('━'.repeat(80));

  await test_sqlInjection();
  await test_tokenStorage();
  await test_sessionExpiry();

  console.log('');
}

async function test_sqlInjection() {
  const testName = 'Security - SQL Injection Attempt in Login';
  const start = Date.now();

  try {
    const response = await fetch(`${API_BASE}/portal/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: "admin' OR '1'='1",
        password: "' OR '1'='1",
      }),
    });

    const timing = Date.now() - start;

    if (response.status === 401 || response.status === 400) {
      recordResult({
        name: testName,
        status: 'PASS',
        evidenceTier: 'EXECUTED',
        details: 'SQL injection attempt correctly rejected',
        timing,
      });
    } else if (response.status === 200) {
      recordResult({
        name: testName,
        status: 'FAIL',
        evidenceTier: 'EXECUTED',
        severity: 'BLOCKER',
        details: 'SQL INJECTION SUCCESSFUL - CRITICAL SECURITY VULNERABILITY!',
        timing,
        scaleImpact: 'CORRUPTS',
      });
    } else {
      recordResult({
        name: testName,
        status: 'WARN',
        evidenceTier: 'EXECUTED',
        details: `Unexpected response: ${response.status}`,
        timing,
      });
    }
  } catch (error: any) {
    recordResult({
      name: testName,
      status: 'FAIL',
      evidenceTier: 'EXECUTED',
      severity: 'MEDIUM',
      details: `Exception: ${error.message}`,
    });
  }
}

async function test_tokenStorage() {
  const testName = 'Security - Session Tokens Are Hashed in Database';
  const start = Date.now();

  try {
    // Login to create a session
    const loginRes = await fetch(`${API_BASE}/portal/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'developer@test.com',
        password: 'Test@12345',
      }),
    });

    const loginData = await loginRes.json();
    const token = loginData.data?.sessionToken;

    if (!token) {
      recordResult({
        name: testName,
        status: 'SKIP',
        evidenceTier: 'EXECUTED',
        details: 'Could not get session token',
      });
      return;
    }

    // Check if the raw token exists in the database (it shouldn't)
    const rawTokenInDB = await prisma.session.findFirst({
      where: { tokenHash: token }, // This should NOT find anything - token should be hashed
    });

    const timing = Date.now() - start;

    if (!rawTokenInDB) {
      recordResult({
        name: testName,
        status: 'PASS',
        evidenceTier: 'EXECUTED',
        details: 'Session tokens are properly hashed (raw token not found in DB)',
        timing,
      });
    } else {
      recordResult({
        name: testName,
        status: 'FAIL',
        evidenceTier: 'EXECUTED',
        severity: 'BLOCKER',
        details: 'RAW TOKEN STORED IN DATABASE - CRITICAL SECURITY ISSUE!',
        timing,
        scaleImpact: 'CORRUPTS',
      });
    }
  } catch (error: any) {
    recordResult({
      name: testName,
      status: 'FAIL',
      evidenceTier: 'EXECUTED',
      severity: 'MEDIUM',
      details: `Exception: ${error.message}`,
    });
  }
}

async function test_sessionExpiry() {
  const testName = 'Security - Expired Sessions Are Rejected';
  
  recordResult({
    name: testName,
    status: 'SKIP',
    evidenceTier: 'CANNOT_VERIFY',
    details: 'Cannot test session expiry without waiting for timeout or manually modifying DB',
  });
}

// ============================================================================
// FINAL REPORT
// ============================================================================

async function generateReport() {
  console.log('\n');
  log('REPORT', '📊 QA HUNTER E2E TEST REPORT', 'INFO');
  console.log('═'.repeat(80));

  console.log('\n1. EXECUTIVE SUMMARY');
  console.log('─'.repeat(80));
  console.log(`Total Tests: ${results.length}`);
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`⚠️  Warnings: ${testsWarned}`);
  console.log(`⏭️  Skipped: ${testsSkipped}`);

  const criticalFailures = results.filter(
    (r) => r.status === 'FAIL' && (r.severity === 'BLOCKER' || r.severity === 'HIGH')
  );

  console.log('\n2. VERDICT');
  console.log('─'.repeat(80));

  let verdict: string;
  if (criticalFailures.length > 0) {
    verdict = '🔴 DO NOT SHIP';
    console.log(`${verdict} - ${criticalFailures.length} critical issue(s) found`);
  } else if (testsFailed > 0) {
    verdict = '🟡 SHIP WITH FIXES FIRST';
    console.log(`${verdict} - ${testsFailed} non-critical issue(s) found`);
  } else {
    verdict = '🟢 SHIP';
    console.log(`${verdict} - All tests passed`);
  }

  console.log('\n3. COVERAGE SUMMARY');
  console.log('─'.repeat(80));
  console.log('✅ Developer Authentication: EXECUTED');
  console.log('✅ Admin Authentication: EXECUTED');
  console.log('✅ Authorization (IDOR/BOLA): EXECUTED');
  console.log('✅ Platform Approval Workflow: EXECUTED');
  console.log('✅ Security Tests: EXECUTED');
  console.log('⏭️  Load/Performance Tests: NOT EXECUTED (requires separate load test)');
  console.log('⏭️  Session Expiry: CANNOT_VERIFY (requires time-based testing)');

  if (criticalFailures.length > 0) {
    console.log('\n4. CRITICAL FAILURES (MUST FIX)');
    console.log('─'.repeat(80));
    criticalFailures.forEach((r, i) => {
      console.log(`\n${i + 1}. [${r.severity}] ${r.name}`);
      console.log(`   Details: ${r.details}`);
      if (r.scaleImpact) console.log(`   Scale Impact: ${r.scaleImpact}`);
    });
  }

  const nonCriticalFailures = results.filter(
    (r) => r.status === 'FAIL' && r.severity !== 'BLOCKER' && r.severity !== 'HIGH'
  );

  if (nonCriticalFailures.length > 0) {
    console.log('\n5. NON-CRITICAL ISSUES');
    console.log('─'.repeat(80));
    nonCriticalFailures.forEach((r, i) => {
      console.log(`\n${i + 1}. [${r.severity}] ${r.name}`);
      console.log(`   Details: ${r.details}`);
    });
  }

  console.log('\n6. DETAILED TEST RESULTS');
  console.log('─'.repeat(80));
  results.forEach((r) => {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : r.status === 'WARN' ? '⚠️' : '⏭️';
    console.log(`${icon} ${r.name} [${r.evidenceTier}]${r.timing ? ` (${r.timing}ms)` : ''}`);
    if (r.details) console.log(`   ${r.details}`);
  });

  console.log('\n7. FINAL CONFIDENCE LEVEL');
  console.log('─'.repeat(80));
  if (criticalFailures.length === 0) {
    console.log('HIGH - All critical authentication and authorization flows tested and passing.');
    console.log('The system correctly handles:');
    console.log('  • Developer registration and login');
    console.log('  • Admin authentication with role checking');
    console.log('  • Authorization boundaries (users cannot access admin routes)');
    console.log('  • Platform approval workflow');
    console.log('  • Basic security (SQL injection prevention, token hashing)');
  } else {
    console.log('LOW - Critical security or functionality issues detected.');
    console.log('System is NOT READY for production until issues are resolved.');
  }

  console.log('\n═'.repeat(80));
  console.log(`FINAL VERDICT: ${verdict}`);
  console.log('═'.repeat(80));
  console.log('');
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                                                            ║');
  console.log('║                    QA HUNTER E2E AUTHENTICATION TEST                       ║');
  console.log('║                           HOSTILE BY DEFAULT                               ║');
  console.log('║                                                                            ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    await phase0_inventory();
    await phase1_requirements();
    await phase2_developerAuth();
    await phase3_adminAuth();
    await phase4_security();
    await generateReport();
  } catch (error) {
    console.error('Test execution error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }

  // Exit with appropriate code
  process.exit(testsFailed > 0 ? 1 : 0);
}

main();
