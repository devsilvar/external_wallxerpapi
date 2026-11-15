# Customer API Specification & Simplification Masterplan
### Authoritative Plan: `customer-api.md` (Derived from `simplification-plan-reviewed-v2.md`)
### Sources of Truth: `simplification-plan.md` → `simplification-plan-reviewed.md` → `simplification-plan-reviewed-v2.md` → `external-api/` codebase
### Status: Planning Mode Only — Zero Code Modified

---

# 1. EXECUTIVE SUMMARY & VERDICT

The goal is to provide a clean, stress-free B2B API that partner companies can easily integrate to allow their customers to record **Sales**, record **Expenses**, generate **Invoices** (with downloadable commercial PDF), and get **Profit/Tax Summaries** — without device activation ceremonies, without Paystack, and without settlement accounts.

### Core Architectural Decisions:
1. **Server-to-Server Authentication**: One Platform API key per partner (`Authorization: Bearer <platform-api-key>`). No device tokens or activation codes.
2. **Path-Based Customer Scoping**: `/api/external/v1/accounts/:accountId/*` where `:accountId` supports **both** the partner's string `externalCustomerId` (e.g. `user-123`) and internal UUIDs, strictly scoped by `platformId`.
3. **Disambiguation of "Account" vs "Customer"**:
   - Partner's merchant/tenant = **`Account`** (`Business` model, accessed via `/accounts/:accountId`).
   - Merchant's buyer/invoicing client = **`Customer`** (`Customer` model, accessed via `/accounts/:accountId/customers`).
4. **Idempotent Account Onboarding**: `POST /api/external/v1/accounts` registers or syncs a merchant under the partner platform. Assigns `userId = platform.ownerUserId`.
5. **Profit & Cash Summary**: Dedicated `GET /accounts/:accountId/profit-summary` returning `{ totalSales, totalExpenses, netProfit }` for any date range (bounded to $\le 366$ days).
6. **Preservation of Core Assets**: All sales idempotency, expense recording, invoice numbering, commercial PDF rendering, tombstone sync, and retention jobs remain **100% intact**.

---

# 2. AUDIT FINDINGS (WHAT WAS WRONG WITH OLD PLANS)

1. **Destructive Migration on Live Columns**: Old plan proposed dropping columns without checking if active services or indexes relied on them. The revised plan drops only unused settlement/Paystack columns and drops the dead index `idx_sales_business_id_dva_origin_status`.
2. **Ambiguous Route Mounting**: Mounting `POST /accounts` must occur explicitly before `v1Router.use('/accounts/:accountId', accountRouter)` to avoid route shadowing.
3. **Conflating Business vs Customer**: Clarified that `Business` is the partner's merchant (`account`), while `Customer` is the merchant's buyer.
4. **Missing Platform API Key Issuance**: Old plan assumed API keys exist, but no CLI existed to mint them. Added `src/cli/platform.ts` (`create-platform`, `regenerate-api-key`, `list-platforms`).
5. **Test Migration Scope**: 22 integration test files seeded `externalDevice` directly. The revised plan defines the exact migration path for all tests, including rewriting `tenancy.test.ts` to test two platforms instead of two devices.
6. **Tax Policy & Revenue Undercount**: `src/tax-guard.ts` forbids tax computation on this external surface. Renamed endpoint to `profit-summary`, counting all cash-in sales (including paid-invoice sales with `isTaxable: false`).
7. **UUID-Shaped Customer ID Guard**: Enforced `OnboardAccountSchema` rejecting UUID-shaped `customerId`s at creation time to prevent namespace collisions in the dual-lookup bridge.
8. **Rate Limiting Security**: Keying rate limits on `hashToken(rawToken)` rather than the raw bearer token to prevent credential exposure in logs or memory dumps.

---

# 3. ARCHITECTURE (BEFORE VS AFTER)

| Dimension | Previous Architecture | Simplified Architecture |
|---|---|---|
| **Auth Scheme** | Multi-step: activation code $\to$ device token $\to$ device rotation grace period | Direct: Server-to-server Platform API Key (`Bearer <platform-api-key>`) |
| **Merchant Resolution** | Matched `accountId` UUID against `req.device.businessId` | Resolves partner's string `customerId` directly via composite index `(platform_id, external_customer_id)` with UUID fallback |
| **Merchant Onboarding** | CSV import CLI only (`provision.ts`) | Real-time idempotent API endpoint (`POST /api/external/v1/accounts`) + CSV CLI |
| **Banking / Paystack** | Virtual accounts, split percentages, subaccounts, settlement banks | **Completely Removed** (partner handles their own payment rails) |
| **Tax/Profit Calculation** | Manual invoice calculation only | Dedicated `GET /accounts/:accountId/profit-summary` aggregating sales, expenses, and net profit |
| **Subscription Gate** | Double-check on every request (`platform.subscriptionExpiresAt` + `business.subscriptionExpiresAt`) | Administrative suspension only (`isActive: false` $\to$ 403 Forbidden) |
| **Rate Limiter** | Token bucket keyed on device token hash | Token bucket keyed on SHA-256 hash of partner Platform API Key |

---

# 4. VERIFIED FILE IMPACT

```
external-api/
├── prisma/
│   ├── schema.prisma                                     [MUST MODIFY]
│   └── migrations/
│       └── 20261115000001_simplify_external_api/
│           └── migration.sql                             [MUST CREATE]
├── src/
│   ├── app.ts                                           [MUST MODIFY]
│   ├── config.ts                                        [MUST MODIFY]
│   ├── openapi.ts                                       [MUST MODIFY]
│   ├── types/
│   │   └── express.d.ts                                 [MUST MODIFY]
│   ├── middleware/
│   │   ├── authenticatePartner.ts                       [MUST CREATE]
│   │   ├── resolveAccountByPartner.ts                   [MUST CREATE]
│   │   ├── rateLimit.ts                                 [MUST MODIFY]
│   │   ├── requirePlatformActive.ts                     [MUST MODIFY]
│   │   ├── requireAccountActive.ts                      [MUST MODIFY]
│   │   ├── auth.ts                                      [MUST DELETE]
│   │   ├── resolveAccount.ts                            [MUST DELETE]
│   │   └── requireSubscription.ts                       [MUST DELETE]
│   ├── routes/
│   │   ├── accounts.routes.ts                           [MUST MODIFY]
│   │   ├── profit.routes.ts                             [MUST CREATE]
│   │   ├── admin.routes.ts                              [MUST MODIFY]
│   │   └── auth.routes.ts                               [MUST DELETE]
│   ├── services/
│   │   ├── account.service.ts                           [MUST MODIFY]
│   │   ├── admin.service.ts                             [MUST MODIFY]
│   │   └── device.service.ts                            [MUST DELETE]
│   ├── db/
│   │   ├── platform.repo.ts                             [MUST CREATE]
│   │   ├── admin.repo.ts                                [MUST MODIFY]
│   │   ├── sandbox.repo.ts                              [MUST MODIFY]
│   │   ├── provision.repo.ts                            [MUST MODIFY]
│   │   ├── scoped.ts                                    [MUST MODIFY]
│   │   └── device.repo.ts                               [MUST DELETE]
│   ├── cli/
│   │   ├── platform.ts                                  [MUST CREATE]
│   │   ├── admin.ts                                     [MUST MODIFY]
│   │   ├── provision.ts                                 [MUST MODIFY]
│   │   └── seed-sandbox.ts                              [MUST MODIFY]
│   └── validators/
│       ├── account.validator.ts                         [MUST MODIFY]
│       └── auth.validator.ts                            [MUST DELETE]
└── tests/
    └── integration/
        ├── partner-auth.test.ts                         [MUST CREATE]
        ├── profit-summary.test.ts                       [MUST CREATE]
        ├── auth.test.ts                                 [MUST DELETE]
        └── rotate-grace.test.ts                         [MUST DELETE]
```

### Files Preserved Untouched (DO NOT TOUCH):
- `src/services/sale.service.ts`
- `src/services/expense.service.ts`
- `src/services/invoice.service.ts`
- `src/services/customer.service.ts`
- `src/services/idempotency.ts`
- `src/services/sequence.service.ts`
- `src/services/sync.service.ts`
- `src/routes/sales.routes.ts`
- `src/routes/expenses.routes.ts`
- `src/routes/invoices.routes.ts`
- `src/routes/customers.routes.ts`
- `src/routes/deletions.routes.ts`
- `src/routes/public.routes.ts`
- `src/routes/health.routes.ts`
- `src/routes/docs.routes.ts`
- `src/jobs/retention.job.ts`
- `src/tax-guard.ts`
- `src/pdf/*` (all PDF rendering files)
- `src/lib/*` (all utilities: cursor, dates, errors, logger, money, token)

---

# 5. IMPLEMENTATION STEPS

### Phase 0 — Pre-Migration Validation
- Verify `prisma/schema.prisma` definitions against the initial migration.
- Ensure database connectivity and take backup snapshot before dropping columns.

### Phase 1 — Database Migration & Dead Code Cleanup
- Write `prisma/migrations/20261115000001_simplify_external_api/migration.sql`:
  - Drop table `external_devices`.
  - Drop settlement/Paystack columns from `businesses`.
  - Drop dead index `idx_sales_business_id_dva_origin_status`.
- Apply migration via `npx prisma migrate deploy` and run `npx prisma generate`.
- Delete dead files: `auth.ts`, `resolveAccount.ts`, `requireSubscription.ts`, `auth.routes.ts`, `device.service.ts`, `device.repo.ts`, `auth.validator.ts`.

### Phase 2 — Core Authentication & Resolution Middleware
- Create `src/db/platform.repo.ts` (`findPlatformByApiKeyHash`, `createPlatform`, `regeneratePlatformApiKey`).
- Create `src/middleware/authenticatePartner.ts` (SHA-256 hash lookup, active platform check, fire-and-forget `apiKeyLastUsedAt` update).
- Create `src/middleware/resolveAccountByPartner.ts` (dual-lookup: `(platformId, externalCustomerId)` first, UUID fallback).
- Update `src/types/express.d.ts` (attach `platform`).
- Update `requirePlatformActive.ts` and `requireAccountActive.ts`.
- Update `rateLimit.ts` (`tokenKeyGenerator` hashes raw token).

### Phase 3 — App Routing, Onboarding & Platform CLI
- Update `src/app.ts`: Mount `POST /accounts` onboarding endpoint before the `/accounts/:accountId` route.
- Create `OnboardAccountSchema` in `account.validator.ts` (rejects UUID-shaped customer IDs).
- Implement `onboardAccount` in `account.service.ts` (atomic creation with `platform.ownerUserId`, sequential `merchantId`, P2002 race handling).
- Create `src/cli/platform.ts` CLI tool (`create-platform`, `regenerate-api-key`, `list-platforms`).

### Phase 4 — Profit Summary Endpoint
- Create `src/routes/profit.routes.ts`: `GET /accounts/:accountId/profit-summary?from=&to=` (bounded to $\le 366$ days).
- Add aggregate queries in `src/db/scoped.ts` (`aggregateSales`, `aggregateExpenses`).
- Return `{ totalSales, totalExpenses, netProfit, currency: 'NGN', period }`.

### Phase 5 — Admin Surface, Sandbox & Documentation
- Clean `admin.routes.ts`, `admin.service.ts`, and `admin.repo.ts` (remove device endpoints and device count).
- Clean `cli/admin.ts` (remove `issueActivationCode`) and `cli/provision.ts`.
- Update `src/db/sandbox.repo.ts` and `cli/seed-sandbox.ts` to use `SANDBOX_API_KEY`.
- Update `src/openapi.ts` with `PlatformBearerAuth`, onboarding, and profit-summary paths. Regenerate snapshots.

### Phase 6 — Test Suite Realignment & Verification
- Delete `auth.test.ts` and `rotate-grace.test.ts`.
- Rewrite `tenancy.test.ts` with two platforms.
- Update `beforeAll` in 22 integration tests to seed `platform.apiKeyHash`.
- Add `partner-auth.test.ts` and `profit-summary.test.ts`.
- Run full verification suite: `npx prisma validate`, `npx tsc --noEmit`, `npx eslint . --max-warnings=0`, `node scripts/assert-tenancy.mjs`, `npx vitest run`.

---

# 6. ACCEPTANCE CRITERIA

| ID | Specification | Validation Check |
|---|---|---|
| **AC-01** | Partner accesses customer sales using Platform API key | Integration test passes |
| **AC-02** | Invalid or missing Platform API key returns `401 TOKEN_INVALID` | Integration test passes |
| **AC-03** | Suspended platform returns `403 PLATFORM_SUSPENDED` | Integration test passes |
| **AC-04** | Non-existent customer identifier returns `404 NOT_FOUND` | Integration test passes |
| **AC-05** | `POST /api/external/v1/accounts` registers new customer (201) and returns existing on duplicate (200) | Integration test passes |
| **AC-06** | `GET /accounts/:accountId/profit-summary` correctly aggregates sales, expenses, and net profit | Integration test passes |
| **AC-07** | Core operations (Sales, Expenses, Invoices, PDF download) operate without regression | Full test suite passes |
| **AC-08** | All device tables, routes, Paystack/settlement columns eradicated | Schema & codebase search clean |
| **AC-09** | Admin surface operations (`/admin/*`) remain intact and functional | Admin integration test passes |
| **AC-10** | TypeScript (`tsc --noEmit`) and ESLint pass with zero warnings/errors | Build check clean |
