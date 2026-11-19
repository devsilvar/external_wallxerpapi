import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/createTestApp.js';

describe('CORS middleware (src/middleware/cors.ts)', () => {
  const allowedOrigin = 'https://admin.example.com';
  const secondAllowedOrigin = 'http://localhost:5175';
  const disallowedOrigin = 'https://malicious-site.com';

  const app = createTestApp({
    EXTERNAL_CORS_ORIGINS: `${allowedOrigin}, ${secondAllowedOrigin}`,
  });

  it('sets Access-Control-Allow-Origin, Vary, and Expose-Headers for allowlisted origin', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', allowedOrigin);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(res.headers['vary']).toContain('Origin');
    expect(res.headers['access-control-expose-headers']).toContain('X-Request-Id');
    expect(res.headers['access-control-expose-headers']).toContain('Retry-After');
    expect(res.headers['access-control-expose-headers']).toContain('RateLimit-Limit');
    expect(res.headers['access-control-expose-headers']).toContain('RateLimit-Remaining');
    expect(res.headers['access-control-expose-headers']).toContain('RateLimit-Reset');
  });

  it('sets no CORS headers for non-allowlisted origin (deny by default)', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', disallowedOrigin);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-expose-headers']).toBeUndefined();
  });

  it('handles requests with no Origin header unchanged (server-to-server / curl)', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers preflight OPTIONS request with 204 and CORS headers for allowlisted origin', async () => {
    const res = await request(app)
      .options('/api/external/v1/accounts')
      .set('Origin', secondAllowedOrigin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Authorization, Content-Type, Idempotency-Key');

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(res.headers['access-control-allow-origin']).toBe(secondAllowedOrigin);
    expect(res.headers['access-control-allow-methods']).toContain('GET,POST,PUT,PATCH,DELETE,OPTIONS');
    expect(res.headers['access-control-allow-headers']).toContain('Authorization, Content-Type, Idempotency-Key');
    expect(res.headers['access-control-max-age']).toBe('600');
  });

  it('does not set CORS preflight headers for preflight from disallowed origin', async () => {
    const res = await request(app)
      .options('/api/external/v1/accounts')
      .set('Origin', disallowedOrigin);

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
