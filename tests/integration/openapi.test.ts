import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { EXPENSE_CATEGORIES } from '../../src/validators/expense.validator.js';
import { SALES_SOURCES } from '../../src/openapi.js';

describe('OpenAPI documentation and spec (tests/integration/openapi.test.ts)', () => {
  const config = loadConfig({
    DATABASE_URL: process.env['DATABASE_URL']!,
    NODE_ENV: 'test',
  });
  const app = createApp(config);

  it('GET /openapi.json returns valid OpenAPI 3.1.0 document with all routes, admin endpoints, and enums', async () => {
    const res = await request(app).get('/openapi.json');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const spec = res.body;
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toBe('Wowo External API');

    // Assert 27 ExpenseCategory members and 15 SalesSource members
    expect(spec.components.schemas.ExpenseCategory.enum).toHaveLength(27);
    expect(EXPENSE_CATEGORIES).toHaveLength(27);

    expect(spec.components.schemas.SalesSource.enum).toHaveLength(15);
    expect(SALES_SOURCES).toHaveLength(15);

    // Assert tags are present and categorized
    expect(Array.isArray(spec.tags)).toBe(true);
    const tagNames = spec.tags.map((t: { name: string }) => t.name);
    expect(tagNames).toContain('System & Health');
    expect(tagNames).toContain('Authentication & Lifecycle');
    expect(tagNames).toContain('Merchant Profile');
    expect(tagNames).toContain('Customers');
    expect(tagNames).toContain('Sales Transactions');
    expect(tagNames).toContain('Expenses');
    expect(tagNames).toContain('Invoices & Commercial Documents');
    expect(tagNames).toContain('Sync & Keyset Polling');
    expect(tagNames).toContain('Public Capability Links');
    expect(tagNames).toContain('Admin - Platforms');
    expect(tagNames).toContain('Admin - Accounts');
    expect(tagNames).toContain('Admin - Devices & Codes');
    expect(tagNames).toContain('Admin - Audit & Observability');
    expect(tagNames).toContain('Admin - System Usage');

    // Assert partner & merchant routes are present
    const paths = Object.keys(spec.paths);
    expect(paths).toContain('/health');
    expect(paths).toContain('/api/external/v1/auth/activate');
    expect(paths).toContain('/api/external/v1/auth/rotate');
    expect(paths).toContain('/api/external/v1/auth/revoke');
    expect(paths).toContain('/api/external/v1/me');
    expect(paths).toContain('/api/external/v1/accounts/{accountId}');
    expect(paths).toContain('/api/external/v1/accounts/{accountId}/customers');
    expect(paths).toContain('/api/external/v1/accounts/{accountId}/sales');
    expect(paths).toContain('/api/external/v1/accounts/{accountId}/expenses');
    expect(paths).toContain('/api/external/v1/accounts/{accountId}/invoices');
    expect(paths).toContain('/api/external/v1/accounts/{accountId}/deletions');
    expect(paths).toContain('/api/external/v1/public/invoices/{shareToken}/pdf');

    // Assert admin routes are present
    expect(paths).toContain('/api/external/v1/admin/platforms');
    expect(paths).toContain('/api/external/v1/admin/platforms/{id}');
    expect(paths).toContain('/api/external/v1/admin/accounts');
    expect(paths).toContain('/api/external/v1/admin/accounts/{id}');
    expect(paths).toContain('/api/external/v1/admin/accounts/{id}/devices');
    expect(paths).toContain('/api/external/v1/admin/accounts/{id}/devices/{deviceId}/revoke');
    expect(paths).toContain('/api/external/v1/admin/accounts/{id}/issue-code');
    expect(paths).toContain('/api/external/v1/admin/audit-logs');
    expect(paths).toContain('/api/external/v1/admin/usage');

    // Assert security schemes
    expect(spec.components.securitySchemes.DeviceBearerAuth).toBeDefined();
    expect(spec.components.securitySchemes.AdminBearerAuth).toBeDefined();
  });

  it('GET /swagger.json returns identical specification payload to /openapi.json', async () => {
    const resOpenApi = await request(app).get('/openapi.json');
    const resSwagger = await request(app).get('/swagger.json');

    expect(resSwagger.status).toBe(200);
    expect(resSwagger.headers['content-type']).toContain('application/json');
    expect(resSwagger.body).toEqual(resOpenApi.body);
  });

  it('GET /docs returns interactive Swagger UI with categorization and expansion configured', async () => {
    const res = await request(app).get('/docs');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('SwaggerUIBundle');
    expect(res.text).toContain('/openapi.json');
    expect(res.text).toContain("docExpansion: 'list'");
    expect(res.text).toContain('filter: true');
  });

  it('GET /swagger and GET /api-docs aliases serve the interactive Swagger UI', async () => {
    const resSwagger = await request(app).get('/swagger');
    expect(resSwagger.status).toBe(200);
    expect(resSwagger.text).toContain('SwaggerUIBundle');

    const resApiDocs = await request(app).get('/api-docs');
    expect(resApiDocs.status).toBe(200);
    expect(resApiDocs.text).toContain('SwaggerUIBundle');
  });

  it('GET /docs?expand=full renders Swagger UI with full operation expansion', async () => {
    const res = await request(app).get('/docs?expand=full');

    expect(res.status).toBe(200);
    expect(res.text).toContain("docExpansion: 'full'");
  });
});
