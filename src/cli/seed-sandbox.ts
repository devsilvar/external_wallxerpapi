import {
  seedSandboxTenant,
  type SandboxSeedResult,
  SANDBOX_PLATFORM_NAME,
  SANDBOX_EXTERNAL_CUSTOMER_ID,
  SANDBOX_API_KEY,
 } from '../db/sandbox.repo.js';

export {
  seedSandboxTenant,
  type SandboxSeedResult,
  SANDBOX_PLATFORM_NAME,
  SANDBOX_EXTERNAL_CUSTOMER_ID,
  SANDBOX_API_KEY,
 };

// Allow direct CLI execution: `tsx src/cli/seed-sandbox.ts`
if (process.argv[1]?.endsWith('seed-sandbox.ts')) {
  seedSandboxTenant()
    .then((result) => {
      console.log('=====================================================');
      console.log('   WALLXERPAPI — SANDBOX CREDENTIALS');
      console.log('=====================================================');
      console.log(`Account ID (businessId):    ${result.businessId}`);
      console.log(`Merchant ID:                ${result.merchantId}`);
      console.log(`External Customer ID:       ${result.externalCustomerId}`);
      console.log(`Platform API Key:           ${result.apiKey}`);
      console.log('');
      console.log('Sample cURL Command (via External Customer ID):');
      console.log(`curl -X GET "http://localhost:3000/api/external/v1/accounts/${result.externalCustomerId}/sales" \\`);
      console.log(`     -H "Authorization: Bearer ${result.apiKey}"`);
      console.log('=====================================================');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Failed to seed sandbox tenant:', err);
      process.exit(1);
    });
}
