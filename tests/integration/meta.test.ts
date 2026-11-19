import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/createTestApp.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('GET /meta (src/routes/meta.routes.ts)', () => {
  it('returns 200 with system metadata without authentication', async () => {
    const app = createTestApp({
      EXTERNAL_DOCS_URL: 'https://docs.example.com/external-apis',
    });
    const res = await request(app).get('/meta');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.version).toBe('0.1.0');
    expect(res.body.data.environment).toBe('test');
    expect(res.body.data.specUrl).toBe('/openapi.json');
    expect(res.body.data.docsUrl).toBe('https://docs.example.com/external-apis');
    expect(res.headers['x-request-id']).toMatch(UUID_V4);
  });

  it('returns docsUrl as null when EXTERNAL_DOCS_URL is unset', async () => {
    const app = createTestApp();
    const res = await request(app).get('/meta');

    expect(res.status).toBe(200);
    expect(res.body.data.docsUrl).toBeNull();
  });

  it('stays available when EXTERNAL_API_ENABLED is false (kill-switch bypass)', async () => {
    const app = createTestApp({
      EXTERNAL_API_ENABLED: 'false',
    });
    const res = await request(app).get('/meta');

    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe('0.1.0');
  });
});
