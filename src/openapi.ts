import { EXPENSE_CATEGORIES } from './validators/expense.validator.js';
import {
  attachRequestExamples,
  attachResponseAndParameterExamples,
  type SpecForSamples,
} from './openapi.samples.js';

export const SALES_SOURCES = [
  'api',
  'pos',
  'web',
  'mobile',
  'manual',
  'bank_transfer',
  'ussd',
  'qr_code',
  'card',
  'mobile_money',
  'cheque',
  'cash',
  'other',
  'woocommerce',
  'shopify',
] as const;

export function buildOpenApiSpec() {
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'WallxErpApi',
      version: '1.0.0',
      description: `
# WallxErpApi — Business Partner & ERP Integration API

Production integration surface for business ERP platforms, accounting integrations, and administrative back-office operations.

---

### Core Integration Principles:
1. **Authentication Boundaries**:
   - **Partner & Merchant Routes** require \`Authorization: Bearer <partner-api-key>\` issued via platform provisioning CLI (\`npm run platform:create-platform\`).
   - **Administrative Routes** (\`/admin/*\`) require \`Authorization: Bearer <admin-token>\` with optional CIDR/IP allowlisting and token expiry.
   - **Public Routes** (\`/public/*\`, \`/health\`, \`/docs\`, \`/openapi.json\`) are unauthenticated.
2. **Strict Account Tenancy**:
   - All merchant data operations are scoped under \`/accounts/{accountId}\`, where \`/accountId\` can be your platform's \`externalCustomerId\` or the internal account UUID.
   - Accessing an account ID not owned by the authenticated partner platform returns \`404 NOT_FOUND\` (preventing account enumeration).
3. **At-Least-Once Keyset Polling Guarantee**:
   - Keyset pagination over \`(updatedAt, id)\` ensures zero missed updates and stable cursor navigation across large datasets.
   - When \`updatedSince\` is provided (sync mode), results are ordered ascending \`(updatedAt, id)\`.
   - When \`updatedSince\` is omitted (browse mode), results are ordered descending \`(updatedAt, id)\`.
4. **Idempotency Contracts**:
   - **Sales**: Keyed by \`referenceId\`.
   - **Expenses & Invoices**: Keyed by \`externalRef\`.
   - Identical replayed payloads return \`200 OK\` with the original entity.
   - Conflicting duplicate references with differing payloads return \`409 DUPLICATE_REFERENCE\`.
5. **Safe Non-Fiscal Invoicing**:
   - Commercial invoices are non-fiscal commercial billing documents.
   - System enforces \`vatRate = 0\`, \`vatAmount = 0\`, and \`total = subtotal - discount\`. Attempts to inject VAT return \`400 UNKNOWN_FIELD\`.
   - PDFs generated include the mandatory non-fiscal commercial disclaimer.
      `.trim(),
    },
    servers: [
      {
        url: '/',
        description: 'Current Environment Gateway',
      },
      {
        url: 'http://localhost:3000',
        description: 'Local Development Server',
      },
    ],
    tags: [
      { name: 'System & Health', description: 'System health checks, probes, and operational readiness' },
      { name: 'Customer Onboarding', description: 'Idempotent merchant registration and customer account sync under partner platforms' },
      { name: 'Merchant Profile', description: 'Merchant profile discovery, profit summaries, and self-service contact updates' },
      { name: 'Customers', description: 'Customer directory management with external partner ID mapping' },
      { name: 'Sales Transactions', description: 'Sales ingestion, reference reservation, and atomic deletion' },
      { name: 'Expenses', description: 'Business expense recording with non-deductible tax enforcement' },
      { name: 'Invoices & Commercial Documents', description: 'Commercial invoice state machine (draft -> sent -> paid/cancelled) and PDF capability links' },
      { name: 'Sync & Keyset Polling', description: 'Tombstone synchronization for hard-deleted records' },
      { name: 'Public Capability Links', description: 'Unauthenticated capability endpoints for commercial invoice PDF distribution' },
      { name: 'Admin - Platforms', description: 'Platform partner management, billing fee adjustments, and suspension controls' },
      { name: 'Admin - Accounts', description: 'Merchant account lifecycle, live telemetry counts, and administrative suspension' },
      { name: 'Admin - Audit & Observability', description: 'Platform audit logs search and security traceability' },
      { name: 'Admin - System Usage', description: 'System-wide metrics and admin credential security posture audit' },
    ],
    components: {
      securitySchemes: {
        PlatformBearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'Token',
          description: 'Platform API Key (Bearer sk_ext_live_...). Required for all partner and merchant routes under /accounts/*',
        },
        AdminBearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'Token',
          description: 'Admin Bearer Token seeded via CLI or operator portal. Required for all routes under /admin/*',
        },
      },
      schemas: {
        SalesSource: {
          type: 'string',
          enum: SALES_SOURCES,
          description: 'Channel or origin where the sale occurred',
        },
        ExpenseCategory: {
          type: 'string',
          enum: EXPENSE_CATEGORIES,
          description: 'Operating expense categorization code',
        },
        ErrorEnvelope: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message', 'requestId'],
              properties: {
                code: { type: 'string', example: 'NOT_FOUND' },
                message: { type: 'string', example: 'Resource not found' },
                requestId: { type: 'string', example: 'req_01j7bc9k8e2m1a3f4e5d6c7b8a' },
                details: { type: 'object', nullable: true },
              },
            },
          },
        },
        AccountProfile: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            merchantId: { type: 'string', example: 'WALLX0000001' },
            businessName: { type: 'string', example: 'Lekki Supermarket Ltd' },
            ownerName: { type: 'string', example: 'Chinedu Okafor' },
            businessType: { type: 'string', nullable: true, example: 'retail' },
            address: { type: 'string', nullable: true, example: '14 Admiralty Way' },
            city: { type: 'string', nullable: true, example: 'Lekki' },
            state: { type: 'string', nullable: true, example: 'Lagos' },
            contactPhone: { type: 'string', nullable: true, example: '+2348012345678' },
            contactEmail: { type: 'string', nullable: true, example: 'contact@lekkisupermarket.ng' },
            isActive: { type: 'boolean', example: true },
            subscriptionExpiresAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Customer: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            externalId: { type: 'string', example: 'POS-CUST-9821' },
            name: { type: 'string', example: 'Folake Adeleke' },
            email: { type: 'string', nullable: true, example: 'folake@example.com' },
            phone: { type: 'string', nullable: true, example: '+2348099887766' },
            address: { type: 'string', nullable: true, example: 'Plot 5 Victoria Island' },
            city: { type: 'string', nullable: true, example: 'Lagos' },
            state: { type: 'string', nullable: true, example: 'Lagos' },
            taxId: { type: 'string', nullable: true, example: '10987654-0001' },
            notes: { type: 'string', nullable: true, example: 'VIP Retail Customer' },
            isActive: { type: 'boolean', example: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        SaleLineItem: {
          type: 'object',
          required: ['name', 'quantity', 'unitPrice', 'lineTotal'],
          properties: {
            name: { type: 'string', maxLength: 200, example: 'Basmati Rice 5kg' },
            quantity: { type: 'string', example: '2.00' },
            unitPrice: { type: 'string', example: '8500.00' },
            lineTotal: { type: 'string', example: '17000.00' },
            sortOrder: { type: 'integer', default: 0, example: 0 },
          },
        },
        Sale: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            referenceId: { type: 'string', example: 'POS-ORD-2026-9921' },
            amount: { type: 'string', example: '17000.00' },
            source: { $ref: '#/components/schemas/SalesSource' },
            status: { type: 'string', enum: ['pending', 'confirmed', 'cancelled', 'refunded'], example: 'confirmed' },
            transactionDate: { type: 'string', format: 'date', example: '2026-11-15' },
            description: { type: 'string', nullable: true, example: 'Counter Sale Terminal 1' },
            customerId: { type: 'string', format: 'uuid', nullable: true },
            customerName: { type: 'string', nullable: true, example: 'Walk-in Customer' },
            items: {
              type: 'array',
              items: { $ref: '#/components/schemas/SaleLineItem' },
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Expense: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            externalRef: { type: 'string', example: 'EXP-2026-4401' },
            category: { $ref: '#/components/schemas/ExpenseCategory' },
            categoryDetail: { type: 'string', nullable: true, example: 'Generator Fuel' },
            description: { type: 'string', example: 'Diesel 50 Litres' },
            amount: { type: 'string', example: '65000.00' },
            quantity: { type: 'string', example: '1.00' },
            unitPrice: { type: 'string', nullable: true, example: '65000.00' },
            expenseDate: { type: 'string', format: 'date', example: '2026-11-15' },
            receiptUrl: { type: 'string', nullable: true, example: 'https://cdn.partner.com/receipts/exp4401.jpg' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        InvoiceLineItem: {
          type: 'object',
          required: ['description', 'quantity', 'unitPrice'],
          properties: {
            description: { type: 'string', example: 'Logistics and Delivery Services' },
            quantity: { type: 'string', example: '3.00' },
            unitPrice: { type: 'string', example: '12000.00' },
            sortOrder: { type: 'integer', example: 0 },
          },
        },
        Invoice: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            invoiceNumber: { type: 'string', example: 'WX-2026-001' },
            externalRef: { type: 'string', example: 'INV-WALLX-991' },
            customerId: { type: 'string', format: 'uuid', nullable: true },
            customerName: { type: 'string', example: 'Dangote Foods Distribution' },
            subtotal: { type: 'string', example: '36000.00' },
            discount: { type: 'string', example: '1000.00' },
            vatRate: { type: 'string', example: '0.00' },
            vatAmount: { type: 'string', example: '0.00' },
            total: { type: 'string', example: '35000.00' },
            currency: { type: 'string', example: 'NGN' },
            status: { type: 'string', enum: ['draft', 'sent', 'paid', 'cancelled', 'overdue'], example: 'sent' },
            issueDate: { type: 'string', format: 'date', example: '2026-11-15' },
            dueDate: { type: 'string', format: 'date', example: '2026-11-30' },
            sentAt: { type: 'string', format: 'date-time', nullable: true },
            paidAt: { type: 'string', format: 'date-time', nullable: true },
            cancelledAt: { type: 'string', format: 'date-time', nullable: true },
            paymentMethod: { type: 'string', nullable: true, example: 'bank_transfer' },
            linkedSaleId: { type: 'string', format: 'uuid', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Tombstone: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            businessId: { type: 'string', format: 'uuid' },
            entityType: { type: 'string', enum: ['sale', 'expense', 'invoice', 'customer'], example: 'sale' },
            entityId: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        AdminPlatform: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'WallxErpApi Platform' },
            ownerUserId: { type: 'string', format: 'uuid' },
            isActive: { type: 'boolean', example: true },
            suspendedAt: { type: 'string', format: 'date-time', nullable: true },
            suspendedReason: { type: 'string', nullable: true },
            flatFeeNgn: { type: 'string', example: '50.00' },
            subscriptionExpiresAt: { type: 'string', format: 'date-time', nullable: true },
            totalAccounts: { type: 'integer', example: 1250 },
            activeAccounts: { type: 'integer', example: 1210 },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        AdminAccountSummary: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            platformId: { type: 'string', format: 'uuid' },
            platformName: { type: 'string', example: 'WallxErpApi Platform' },
            externalCustomerId: { type: 'string', example: 'WALLX-CUST-8812' },
            merchantId: { type: 'string', example: 'WALLX0001042' },
            businessName: { type: 'string', example: 'Mama Put Kitchen' },
            ownerName: { type: 'string', example: 'Ngozi Eze' },
            contactEmail: { type: 'string', nullable: true, example: 'ngozi@example.com' },
            contactPhone: { type: 'string', nullable: true, example: '+2348033221100' },
            isActive: { type: 'boolean', example: true },
            subscriptionExpiresAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        AdminUsageStats: {
          type: 'object',
          properties: {
            platforms: {
              type: 'object',
              properties: {
                total: { type: 'integer', example: 3 },
                active: { type: 'integer', example: 3 },
              },
            },
            accounts: {
              type: 'object',
              properties: {
                total: { type: 'integer', example: 1420 },
                active: { type: 'integer', example: 1395 },
              },
            },
            entities: {
              type: 'object',
              properties: {
                sales: { type: 'integer', example: 98400 },
                invoices: { type: 'integer', example: 12350 },
                expenses: { type: 'integer', example: 44200 },
              },
            },
            api: {
type: 'object',
properties: {
windowDays: { type: 'integer', example: 30 },
requests: { type: 'integer', example: 18240 },
errors: { type: 'integer', example: 96 },
errorRate: { type: 'number', example: 0.53 },
byPlatform: {
type: 'array',
items: {
type: 'object',
properties: {
platformId: { type: 'string' },
platformName: { type: 'string' },
requests: { type: 'integer', example: 12300 },
errors: { type: 'integer', example: 42 },
},
},
},
},
},
adminCredentials: {
              type: 'object',
              properties: {
                totalAdmins: { type: 'integer', example: 4 },
                activeAdmins: { type: 'integer', example: 4 },
                warnings: {
                  type: 'array',
                  items: { type: 'string' },
                  example: ['WARNING: Admin token "Superadmin Production" (id: admin-uuid) has no expiration date configured.'],
                },
                tokens: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      role: { type: 'string' },
                      hasExpiry: { type: 'boolean' },
                      expiresAt: { type: 'string', nullable: true },
                      hasIpAllowlist: { type: 'boolean' },
                      lastUsedAt: { type: 'string', nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
        AdminCredential: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'backend-admin-proxy' },
            role: { type: 'string', enum: ['admin', 'readonly'], example: 'admin' },
            createdAt: { type: 'string', format: 'date-time' },
            lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
            expiresAt: { type: 'string', format: 'date-time', nullable: true },
            allowedIpsCount: { type: 'integer', example: 0 },
            revokedAt: { type: 'string', format: 'date-time', nullable: true },
          },
          required: ['id', 'name', 'role', 'createdAt', 'allowedIpsCount'],
        },
        CreateAdminInput: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 80, example: 'operator-alice' },
            role: { type: 'string', enum: ['admin', 'readonly'], default: 'admin' },
            expiresAt: { type: 'string', format: 'date-time', nullable: true },
            allowedIps: { type: 'array', items: { type: 'string' } },
          },
          required: ['name'],
        },
        CreatedAdminResponse: {
          type: 'object',
          properties: {
            admin: { $ref: '#/components/schemas/AdminCredential' },
            rawToken: { type: 'string', example: 'ext_admin_live_abc123...' },
          },
          required: ['admin', 'rawToken'],
        },
      },
    },
    paths: {
      // -------------------------------------------------------------
      // SYSTEM & HEALTH
      // -------------------------------------------------------------
      '/health': {
        get: {
          tags: ['System & Health'],
          summary: 'Health probe',
          description: 'Unauthenticated health check returning service operational status and server time.',
          responses: {
            '200': {
              description: 'Service operational',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      timestamp: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/meta': {
        get: {
          tags: ['System & Health'],
          summary: 'Service metadata',
          description: 'Unauthenticated endpoint returning service version, environment, OpenAPI spec location, and documentation URL.',
          responses: {
            '200': {
              description: 'Service metadata',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          version: { type: 'string', example: '0.1.0' },
                          environment: { type: 'string', example: 'production' },
                          specUrl: { type: 'string', example: '/openapi.json' },
                          docsUrl: { type: 'string', nullable: true, example: 'https://docs.example.com/external-apis' },
                        },
                        required: ['version', 'environment', 'specUrl'],
                      },
                    },
                    required: ['data'],
                  },
                },
              },
            },
          },
        },
      },
      '/api/external/v1/accounts/{accountId}/ping': {
        get: {
          tags: ['System & Health'],
          summary: 'Middleware verification probe',
          description: 'Verifies the complete middleware authentication, rate limiting, and entitlement pipeline for an account.',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': {
              description: 'Pipeline operational',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: { ok: { type: 'boolean', example: true } },
                      },
                    },
                  },
                },
              },
            },
            '401': { $ref: '#/components/schemas/ErrorEnvelope' },
            '404': { $ref: '#/components/schemas/ErrorEnvelope' },
          },
        },
      },

      // -------------------------------------------------------------
      // CUSTOMER ONBOARDING
      // -------------------------------------------------------------
      '/api/external/v1/accounts': {
        post: {
          tags: ['Customer Onboarding'],
          summary: 'Onboard or sync merchant account under partner',
          description: 'Idempotently registers or links a merchant business under the calling partner platform. Accepts partner customer ID (cannot be a UUID) and business details. If customerId already exists under this platform, returns 200 OK with the existing account.',
          security: [{ PlatformBearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['customerId', 'businessName'],
                  properties: {
                    customerId: { type: 'string', minLength: 1, maxLength: 100, example: 'CUST-8812', description: 'Your system identifier for this customer (cannot be UUID format).' },
                    businessName: { type: 'string', minLength: 2, maxLength: 255, example: 'Lekki Supermarket Ltd' },
                    ownerName: { type: 'string', minLength: 2, maxLength: 255, example: 'Ngozi Eze' },
                    contactEmail: { type: 'string', format: 'email', example: 'ngozi@example.com' },
                    contactPhone: { type: 'string', example: '+2348033221100' },
                    address: { type: 'string', example: '14 Admiralty Way, Lekki Phase 1' },
                    city: { type: 'string', example: 'Lagos' },
                    state: { type: 'string', example: 'Lagos' },
                    currency: { type: 'string', default: 'NGN', example: 'NGN' },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Merchant account created and linked to partner platform',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { $ref: '#/components/schemas/AccountProfile' },
                    },
                  },
                },
              },
            },
            '200': {
              description: 'Existing merchant account matched by customerId (idempotent)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { $ref: '#/components/schemas/AccountProfile' },
                    },
                  },
                },
              },
            },
            '400': { $ref: '#/components/schemas/ErrorEnvelope' },
            '401': { $ref: '#/components/schemas/ErrorEnvelope' },
            '403': { $ref: '#/components/schemas/ErrorEnvelope' },
          },
        },
      },

      // -------------------------------------------------------------
      // MERCHANT PROFILE SELF-SERVICE & PROFIT
      // -------------------------------------------------------------
      '/api/external/v1/accounts/{accountId}': {
        get: {
          tags: ['Merchant Profile'],
          summary: 'Get merchant profile',
          description: 'Retrieves merchant profile including business name, taxId, contact details, and platform linking.',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [{ name: 'accountId', in: 'path', required: true, schema: { type: 'string' }, description: 'External customer ID or account UUID' }],
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/AccountProfile' } } } } } },
            '404': { description: 'Account not found or tenant mismatch' },
          },
        },
        patch: {
          tags: ['Merchant Profile'],
          summary: 'Update merchant profile',
          description: 'Allows merchant to update contact information, address, and business name. Read-only fields (id, merchantId, isActive, createdAt) are strictly rejected with 400 UNKNOWN_FIELD.',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [{ name: 'accountId', in: 'path', required: true, schema: { type: 'string' }, description: 'External customer ID or account UUID' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    businessName: { type: 'string', maxLength: 100, example: 'Lekki Supermarket Ltd' },
                    ownerName: { type: 'string', maxLength: 100, example: 'Chinedu Okafor' },
                    businessType: { type: 'string', maxLength: 50, example: 'retail' },
                    address: { type: 'string', maxLength: 255, example: '14 Admiralty Way, Lekki Phase 1' },
                    city: { type: 'string', maxLength: 100, example: 'Lagos' },
                    state: { type: 'string', maxLength: 100, example: 'Lagos' },
                    contactPhone: { type: 'string', maxLength: 50, example: '+2348012345678' },
                    contactEmail: { type: 'string', format: 'email', maxLength: 100, example: 'contact@lekkisupermarket.ng' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/AccountProfile' } } } } } },
            '400': { description: 'Attempt to patch read-only field or invalid format' },
          },
        },
      },
      '/api/external/v1/accounts/{accountId}/profit-summary': {
        get: {
          tags: ['Merchant Profile'],
          summary: 'Calculate net profit summary (Sales minus Expenses)',
          description: 'Calculates total sales, total expenses, net profit, and profitability flag across transactions within a specified date window (max 366 days).',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string' }, description: 'External customer ID or account UUID' },
            { name: 'startDate', in: 'query', required: false, schema: { type: 'string', format: 'date', example: '2026-01-01' } },
            { name: 'endDate', in: 'query', required: false, schema: { type: 'string', format: 'date', example: '2026-12-31' } },
          ],
          responses: {
            '200': {
              description: 'Profit calculation summary',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          totalSales: { type: 'string', example: '500000.00' },
                          totalExpenses: { type: 'string', example: '120000.00' },
                          netProfit: { type: 'string', example: '380000.00' },
                          isProfitable: { type: 'boolean', example: true },
                          currency: { type: 'string', example: 'NGN' },
                          startDate: { type: 'string', nullable: true, example: '2026-01-01T00:00:00.000Z' },
                          endDate: { type: 'string', nullable: true, example: '2026-12-31T23:59:59.999Z' },
                          generatedAt: { type: 'string', format: 'date-time' },
                        },
                      },
                    },
                  },
                },
              },
            },
            '400': { $ref: '#/components/schemas/ErrorEnvelope' },
            '401': { $ref: '#/components/schemas/ErrorEnvelope' },
            '404': { $ref: '#/components/schemas/ErrorEnvelope' },
          },
        },
      },

      // -------------------------------------------------------------
      // CUSTOMERS
      // -------------------------------------------------------------
      '/api/external/v1/accounts/{accountId}/customers': {
        get: {
          tags: ['Customers'],
          summary: 'List customers (keyset pagination)',
          description: 'Returns keyset-paginated customer records. Supports ?updatedSince for sync.',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'updatedSince', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Customer' } },
                      page: {
                        type: 'object',
                        properties: { limit: { type: 'integer' }, nextCursor: { type: 'string', nullable: true }, hasMore: { type: 'boolean' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['Customers'],
          summary: 'Create or reactivate customer',
          description: 'Creates a new customer or reactivates a previously soft-deleted customer matching the unique externalId.',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [{ name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['externalId', 'name'],
                  properties: {
                    externalId: { type: 'string', maxLength: 100, example: 'POS-CUST-9821' },
                    name: { type: 'string', maxLength: 200, example: 'Folake Adeleke' },
                    email: { type: 'string', format: 'email', nullable: true, example: 'folake@example.com' },
                    phone: { type: 'string', maxLength: 50, nullable: true, example: '+2348099887766' },
                    address: { type: 'string', maxLength: 255, nullable: true, example: 'Plot 5 Victoria Island' },
                    city: { type: 'string', maxLength: 100, nullable: true, example: 'Lagos' },
                    state: { type: 'string', maxLength: 100, nullable: true, example: 'Lagos' },
                    taxId: { type: 'string', maxLength: 50, nullable: true, example: '10987654-0001' },
                    notes: { type: 'string', maxLength: 500, nullable: true, example: 'VIP Retail Customer' },
                  },
                },
              },
            },
          },
          responses: {
            '201': { content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Customer' } } } } } },
          },
        },
      },
      '/api/external/v1/accounts/{accountId}/customers/{id}': {
        get: {
          tags: ['Customers'],
          summary: 'Get customer by internal ID',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Customer' } } } } } },
            '404': { description: 'Customer not found' },
          },
        },
        patch: {
          tags: ['Customers'],
          summary: 'Update customer',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', example: 'Folake Adeleke' },
                    email: { type: 'string', nullable: true, example: 'folake@example.com' },
                    phone: { type: 'string', nullable: true, example: '+2348099887766' },
                    address: { type: 'string', nullable: true, example: 'Plot 5 Victoria Island' },
                    city: { type: 'string', nullable: true, example: 'Lagos' },
                    state: { type: 'string', nullable: true, example: 'Lagos' },
                    taxId: { type: 'string', nullable: true, example: '10987654-0001' },
                    notes: { type: 'string', nullable: true, example: 'VIP Retail Customer' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Customer' } } } } } },
          },
        },
        delete: {
          tags: ['Customers'],
          summary: 'Soft-delete customer',
          description: 'Sets isActive=false and writes a customer tombstone for sync.',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object', properties: { ok: { type: 'boolean' } } } } } } } },
          },
        },
      },
      '/api/external/v1/accounts/{accountId}/customers/by-external-id/{externalId}': {
        get: {
          tags: ['Customers'],
          summary: 'Get customer by external ID',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'externalId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Customer' } } } } } },
            '404': { description: 'Customer not found' },
          },
        },
      },

      // -------------------------------------------------------------
      // SALES TRANSACTIONS
      // -------------------------------------------------------------
      '/api/external/v1/accounts/{accountId}/sales': {
        get: {
          tags: ['Sales Transactions'],
          summary: 'List sales (keyset pagination)',
          description: 'Returns keyset-paginated sales. When ?updatedSince is present, results are sorted ascending (sync mode).',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'updatedSince', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Sale' } },
                      page: {
                        type: 'object',
                        properties: { limit: { type: 'integer' }, nextCursor: { type: 'string', nullable: true }, hasMore: { type: 'boolean' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['Sales Transactions'],
          summary: 'Create sale transaction (idempotent)',
          description: 'Ingests a sale. referenceId must NOT start with WX- (reserved for commercial invoices). Replaying identical payload returns 200 OK. Differing payload returns 409 DUPLICATE_REFERENCE.',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [{ name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['referenceId', 'amount', 'transactionDate'],
                  properties: {
                    referenceId: { type: 'string', maxLength: 100, example: 'POS-TX-99881' },
                    amount: { type: 'string', example: '15000.00' },
                    source: { $ref: '#/components/schemas/SalesSource', default: 'api' },
                    status: { type: 'string', enum: ['pending', 'confirmed', 'cancelled', 'refunded'], default: 'confirmed' },
                    transactionDate: { type: 'string', format: 'date', example: '2026-11-15' },
                    description: { type: 'string', nullable: true, example: 'Checkout order' },
                    customerId: { type: 'string', format: 'uuid', nullable: true },
                    customerName: { type: 'string', nullable: true, example: 'Segun Adebayo' },
                    items: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/SaleLineItem' },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Sale created', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Sale' } } } } } },
            '200': { description: 'Idempotent replay of existing sale', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Sale' } } } } } },
            '400': { description: 'Invalid reference prefix (^WX- is reserved) or schema violation' },
            '409': { description: 'Duplicate reference with mismatched payload' },
          },
        },
      },
      '/api/external/v1/accounts/{accountId}/sales/{id}': {
        get: {
          tags: ['Sales Transactions'],
          summary: 'Get sale by internal ID',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Sale' } } } } } },
            '404': { description: 'Sale not found' },
          },
        },
        delete: {
          tags: ['Sales Transactions'],
          summary: 'Delete sale transaction',
          description: 'Hard deletes a sale transaction and creates an external_tombstones row. Guard: Refuses with 409 SALE_LINKED_TO_INVOICE if linked to an invoice.',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object', properties: { ok: { type: 'boolean' } } } } } } } },
            '409': { description: 'Sale is linked to an invoice and cannot be deleted' },
          },
        },
      },

      // -------------------------------------------------------------
      // EXPENSES
      // -------------------------------------------------------------
      '/api/external/v1/accounts/{accountId}/expenses': {
        get: {
          tags: ['Expenses'],
          summary: 'List expenses (keyset pagination)',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'updatedSince', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Expense' } },
                      page: {
                        type: 'object',
                        properties: { limit: { type: 'integer' }, nextCursor: { type: 'string', nullable: true }, hasMore: { type: 'boolean' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['Expenses'],
          summary: 'Create expense (idempotent)',
          description: 'Records a business expense. Enforces isDeductible = false in the database. Injections of isDeductible or vatRate fail with 400 UNKNOWN_FIELD. receiptUrl is optional.',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [{ name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['externalRef', 'category', 'amount', 'expenseDate'],
                  properties: {
                    externalRef: { type: 'string', maxLength: 100, example: 'EXP-1092' },
                    category: { $ref: '#/components/schemas/ExpenseCategory' },
                    categoryDetail: { type: 'string', maxLength: 100, nullable: true },
                    description: { type: 'string', maxLength: 500, example: 'Office Internet Subscription' },
                    amount: { type: 'string', example: '25000.00' },
                    quantity: { type: 'string', default: '1.00' },
                    unitPrice: { type: 'string', nullable: true },
                    expenseDate: { type: 'string', format: 'date', example: '2026-11-15' },
                    receiptUrl: { type: 'string', format: 'uri', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            '201': { content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Expense' } } } } } },
            '200': { description: 'Idempotent replay' },
            '400': { description: 'Validation error or tax field injection' },
          },
        },
      },
      '/api/external/v1/accounts/{accountId}/expenses/{id}': {
        get: {
          tags: ['Expenses'],
          summary: 'Get expense by internal ID',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Expense' } } } } } },
            '404': { description: 'Expense not found' },
          },
        },
        delete: {
          tags: ['Expenses'],
          summary: 'Delete expense',
          description: 'Hard deletes an expense and creates an external_tombstones entry.',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object', properties: { ok: { type: 'boolean' } } } } } } } },
          },
        },
      },

      // -------------------------------------------------------------
      // INVOICES & COMMERCIAL DOCUMENTS
      // -------------------------------------------------------------
      '/api/external/v1/accounts/{accountId}/invoices': {
        get: {
          tags: ['Invoices & Commercial Documents'],
          summary: 'List commercial invoices (keyset pagination)',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'updatedSince', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Invoice' } },
                      page: {
                        type: 'object',
                        properties: { limit: { type: 'integer' }, nextCursor: { type: 'string', nullable: true }, hasMore: { type: 'boolean' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['Invoices & Commercial Documents'],
          summary: 'Create commercial invoice',
          description: 'Mints an atomic WX-YYYY-NNN commercial invoice. Rejects discount > subtotal with 400 INVALID_DISCOUNT (never clamps). Rejects vatRate attempts.',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [{ name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['externalRef', 'customerName', 'issueDate', 'dueDate', 'lines'],
                  properties: {
                    externalRef: { type: 'string', maxLength: 100, example: 'INV-POS-882' },
                    customerId: { type: 'string', format: 'uuid', nullable: true },
                    customerName: { type: 'string', maxLength: 200, example: 'Aliko Enterprise' },
                    issueDate: { type: 'string', format: 'date', example: '2026-11-15' },
                    dueDate: { type: 'string', format: 'date', example: '2026-11-30' },
                    discount: { type: 'string', default: '0.00', example: '1000.00' },
                    currency: { type: 'string', default: 'NGN', example: 'NGN' },
                    notes: { type: 'string', maxLength: 500, nullable: true },
                    paymentTerms: { type: 'string', maxLength: 100, nullable: true },
                    lines: {
                      type: 'array',
                      minItems: 1,
                      items: { $ref: '#/components/schemas/InvoiceLineItem' },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': { content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Invoice' } } } } } },
            '400': { description: 'Discount exceeds subtotal or tax field injected' },
          },
        },
      },
      '/api/external/v1/accounts/{accountId}/invoices/{id}': {
        get: {
          tags: ['Invoices & Commercial Documents'],
          summary: 'Get invoice by internal ID',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Invoice' } } } } } },
            '404': { description: 'Invoice not found' },
          },
        },
        put: {
          tags: ['Invoices & Commercial Documents'],
          summary: 'Update draft invoice',
          description: 'Replaces line items on a draft invoice. Guard: Once sent, paid, or cancelled, returns 409 INVOICE_NOT_EDITABLE.',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    customerName: { type: 'string' },
                    dueDate: { type: 'string', format: 'date' },
                    discount: { type: 'string' },
                    lines: { type: 'array', items: { $ref: '#/components/schemas/InvoiceLineItem' } },
                  },
                },
              },
            },
          },
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Invoice' } } } } } },
            '409': { description: 'Invoice is not in draft status' },
          },
        },
        delete: {
          tags: ['Invoices & Commercial Documents'],
          summary: 'Delete draft or cancelled invoice',
          description: 'Hard deletes a draft or cancelled invoice and writes a tombstone. Guard: Non-draft invoices return 409 INVOICE_NOT_DELETABLE.',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object', properties: { ok: { type: 'boolean' } } } } } } } },
            '409': { description: 'Invoice cannot be deleted' },
          },
        },
      },
      '/api/external/v1/accounts/{accountId}/invoices/{id}/send': {
        post: {
          tags: ['Invoices & Commercial Documents'],
          summary: 'Issue invoice (draft -> sent)',
          description: 'Transitions invoice from draft to sent and timestamps sentAt. Calling send on an already-sent invoice is idempotent (returns 200 OK).',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Invoice' } } } } } },
          },
        },
      },
      '/api/external/v1/accounts/{accountId}/invoices/{id}/cancel': {
        post: {
          tags: ['Invoices & Commercial Documents'],
          summary: 'Cancel invoice',
          description: 'Cancels a sent or overdue invoice. Guard: Refused with 409 INVOICE_PAID if already marked paid.',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Invoice' } } } } } },
            '409': { description: 'Cannot cancel a paid invoice' },
          },
        },
      },
      '/api/external/v1/accounts/{accountId}/invoices/{id}/mark-paid': {
        post: {
          tags: ['Invoices & Commercial Documents'],
          summary: 'Mark invoice paid & link sale transaction',
          description: 'Transitions invoice to paid and atomically creates a linked sale transaction with referenceId equal to invoiceNumber, source=api, isTaxable=false.',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    paymentDate: { type: 'string', format: 'date', example: '2026-11-15' },
                    paymentMethod: { type: 'string', example: 'bank_transfer' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Invoice' } } } } } },
            '409': { description: 'Invoice is still draft or already paid' },
            '400': { description: 'paymentDate is in the future or earlier than issueDate' },
          },
        },
      },
      '/api/external/v1/accounts/{accountId}/invoices/{id}/pdf': {
        get: {
          tags: ['Invoices & Commercial Documents'],
          summary: 'Render commercial invoice PDF',
          description: 'Streams the rendered commercial invoice PDF buffer with security headers (X-Robots-Tag, Referrer-Policy: no-referrer). Returns 410 INVOICE_CANCELLED if cancelled.',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'disposition', in: 'query', schema: { type: 'string', enum: ['inline', 'attachment'], default: 'attachment' } },
          ],
          responses: {
            '200': { description: 'PDF stream binary', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } },
            '410': { description: 'Invoice has been cancelled' },
          },
        },
      },
      '/api/external/v1/accounts/{accountId}/invoices/{id}/pdf-link': {
        get: {
          tags: ['Invoices & Commercial Documents'],
          summary: 'Mint public PDF capability link',
          description: 'Generates a 30-day unauthenticated public capability link. Calling again immediately rotates the share token and invalidates the previous link.',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          url: { type: 'string', example: '/public/invoices/9f...32-bytes...a1/pdf' },
                          expiresAt: { type: 'string', format: 'date-time' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // -------------------------------------------------------------
      // SYNC & KEYSET POLLING
      // -------------------------------------------------------------
      '/api/external/v1/accounts/{accountId}/deletions': {
        get: {
          tags: ['Sync & Keyset Polling'],
          summary: 'List tombstones for synchronization',
          description: 'Returns deleted entity tombstones (sale, expense, invoice, customer) ordered by (createdAt, id) for reliable partner synchronization.',
          security: [{ PlatformBearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Tombstone' } },
                      page: {
                        type: 'object',
                        properties: { limit: { type: 'integer' }, nextCursor: { type: 'string', nullable: true }, hasMore: { type: 'boolean' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // -------------------------------------------------------------
      // PUBLIC CAPABILITY LINKS
      // -------------------------------------------------------------
      '/api/external/v1/public/invoices/{shareToken}/pdf': {
        get: {
          tags: ['Public Capability Links'],
          summary: 'Download invoice PDF via public capability link',
          description: 'Public endpoint allowing end-customers to download commercial invoices without authentication. Enforces per-IP and per-token rate limiting.',
          parameters: [
            { name: 'shareToken', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'disposition', in: 'query', schema: { type: 'string', enum: ['inline', 'attachment'], default: 'attachment' } },
          ],
          responses: {
            '200': { description: 'PDF stream binary', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } },
            '404': { description: 'Capability link does not exist or has expired' },
            '410': { description: 'Invoice has been cancelled' },
            '429': { description: 'Rate limit exceeded' },
          },
        },
      },

      // -------------------------------------------------------------
      // ADMIN - PLATFORMS
      // -------------------------------------------------------------
      '/api/external/v1/admin/platforms': {
        get: {
          tags: ['Admin - Platforms'],
          summary: 'List partner platforms',
          description: 'Returns platforms with aggregate account counts and subscription health.',
          security: [{ AdminBearerAuth: [] }],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { data: { type: 'array', items: { $ref: '#/components/schemas/AdminPlatform' } } },
                  },
                },
              },
            },
            '401': { description: 'Admin token missing or invalid' },
            '403': { description: 'Admin token IP forbidden' },
          },
        },
      },
      '/api/external/v1/admin/platforms/{id}': {
        patch: {
          tags: ['Admin - Platforms'],
          summary: 'Update partner platform',
          description: 'Updates flatFeeNgn, subscriptionExpiresAt, or suspends/resumes platform. Platform suspension immediately blocks all merchant requests across that platform.',
          security: [{ AdminBearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    isActive: { type: 'boolean' },
                    suspendedReason: { type: 'string', nullable: true },
                    flatFeeNgn: { type: 'string', example: '75.00' },
                    subscriptionExpiresAt: { type: 'string', format: 'date-time', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/AdminPlatform' } } } } } },
          },
        },
      },

      // -------------------------------------------------------------
      // ADMIN - ACCOUNTS
      // -------------------------------------------------------------
      '/api/external/v1/admin/accounts': {
        get: {
          tags: ['Admin - Accounts'],
          summary: 'List merchant accounts',
          description: 'Searchable, paginated directory of merchant accounts across platforms.',
          security: [{ AdminBearerAuth: [] }],
          parameters: [
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'platformId', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'isActive', in: 'query', schema: { type: 'boolean' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/AdminAccountSummary' } },
                      page: { type: 'object', properties: { total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/external/v1/admin/accounts/{id}': {
        get: {
          tags: ['Admin - Accounts'],
          summary: 'Get merchant account details & live metrics',
          description: 'Returns merchant profile and live count totals of sales, invoices, and expenses.',
          security: [{ AdminBearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          id: { type: 'string', format: 'uuid' },
                          businessName: { type: 'string' },
                          merchantId: { type: 'string' },
                          isActive: { type: 'boolean' },
                          counts: {
                            type: 'object',
                            properties: { sales: { type: 'integer' }, invoices: { type: 'integer' }, expenses: { type: 'integer' } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        patch: {
          tags: ['Admin - Accounts'],
          summary: 'Suspend or resume merchant account',
          description: 'Administratively suspends or resumes a merchant account. A suspended account returns 403 ACCOUNT_INACTIVE on all data routes.',
          security: [{ AdminBearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    isActive: { type: 'boolean' },
                    subscriptionExpiresAt: { type: 'string', format: 'date-time', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/AccountProfile' } } } } } },
          },
        },
      },

      // -------------------------------------------------------------
      // ADMIN - AUDIT LOGS
      // -------------------------------------------------------------
      '/api/external/v1/admin/audit-logs': {
        get: {
          tags: ['Admin - Audit & Observability'],
          summary: 'Search operational audit logs',
          description: 'Queries administrative and operational audit events with filtering by actor, action, resource, or date range.',
          security: [{ AdminBearerAuth: [] }],
          parameters: [
            { name: 'businessId', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'actor', in: 'query', schema: { type: 'string' } },
            { name: 'action', in: 'query', schema: { type: 'string' } },
            { name: 'resourceType', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { type: 'object' } },
                      page: { type: 'object', properties: { limit: { type: 'integer' }, nextCursor: { type: 'string', nullable: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // -------------------------------------------------------------
      // ADMIN - USAGE & CREDENTIAL AUDIT
      // -------------------------------------------------------------
      '/api/external/v1/admin/usage': {
        get: {
          tags: ['Admin - System Usage'],
          summary: 'Get usage stats & admin credential audit',
          description: 'Returns live system aggregations across platforms, accounts, sales, and invoices. Audits admin token expiration and highlights long-lived or perpetual credentials.',
          security: [{ AdminBearerAuth: [] }],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { data: { $ref: '#/components/schemas/AdminUsageStats' } },
                  },
                },
              },
            },
          },
        },
      },
      // -------------------------------------------------------------
      // ADMIN - CREDENTIAL MANAGEMENT
      // -------------------------------------------------------------
      '/api/external/v1/admin/admins': {
        get: {
          tags: ['Admin - Credentials'],
          summary: 'List administrator credentials',
          description: 'Returns all configured administrator tokens with usage and expiration metadata. Secrets and hashes are omitted.',
          security: [{ AdminBearerAuth: [] }],
          responses: {
            '200': {
              description: 'List of admin credentials',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/AdminCredential' },
                      },
                    },
                    required: ['data'],
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['Admin - Credentials'],
          summary: 'Create administrator credential',
          description: 'Mints a new administrator token. The raw bearer token is returned in the response body EXACTLY ONCE.',
          security: [{ AdminBearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateAdminInput' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Administrator credential created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { $ref: '#/components/schemas/CreatedAdminResponse' },
                    },
                    required: ['data'],
                  },
                },
              },
            },
          },
        },
      },
      '/api/external/v1/admin/admins/{id}': {
        delete: {
          tags: ['Admin - Credentials'],
          summary: 'Revoke administrator credential',
          description: 'Immediately revokes an administrator token. Future requests using this token will be rejected with 401.',
          security: [{ AdminBearerAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'The admin record UUID to revoke',
            },
          ],
          responses: {
            '200': {
              description: 'Administrator credential revoked',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          id: { type: 'string', format: 'uuid' },
                          name: { type: 'string' },
                          revokedAt: { type: 'string', format: 'date-time' },
                        },
                        required: ['id', 'name', 'revokedAt'],
                      },
                    },
                    required: ['data'],
                  },
                },
              },
            },
            '404': {
              description: 'Administrator credential not found',
            },
          },
        },
      },
    },
  };

  // The console seeds its JSON editor from request-body `example` values, so every endpoint gets
  // one. Deriving it here (rather than hand-writing 20 examples) keeps it faithful to the schema.
  attachRequestExamples(spec as unknown as SpecForSamples);
  attachResponseAndParameterExamples(spec as unknown as SpecForSamples);

  return spec;
}
