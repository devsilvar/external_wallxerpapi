import {
  seedSandboxTenant,
  type SandboxSeedResult,
  SANDBOX_PLATFORM_NAME,
  SANDBOX_EXTERNAL_CUSTOMER_ID,
  SANDBOX_TEST_TOKEN,
} from '../db/sandbox.repo.js';

export {
  seedSandboxTenant,
  type SandboxSeedResult,
  SANDBOX_PLATFORM_NAME,
  SANDBOX_EXTERNAL_CUSTOMER_ID,
  SANDBOX_TEST_TOKEN,
};

// Allow direct CLI execution: `tsx src/cli/seed-sandbox.ts`
if (process.argv[1]?.endsWith('seed-sandbox.ts')) {
  seedSandboxTenant()
    .then((result) => {
      console.log('=====================================================');
      console.log('   WOWO EXTERNAL API — SANDBOX CREDENTIALS');
      console.log('=====================================================');
      console.log(`Account ID (businessId): ${result.businessId}`);
      console.log(`Merchant ID:             ${result.merchantId}`);
      console.log(`External Customer ID:    ${result.externalCustomerId}`);
      console.log(`Sandbox Device Token:    ${result.deviceToken}`);
      console.log('');
      console.log('Sample cURL Command:');
      console.log(`curl -X GET "http://localhost:3000/api/external/v1/accounts/${result.businessId}/sales" \\`);
      console.log(`     -H "Authorization: Bearer ${result.deviceToken}"`);
      console.log('=====================================================');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Failed to seed sandbox tenant:', err);
      process.exit(1);
    });
}
