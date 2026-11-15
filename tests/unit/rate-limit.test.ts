import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { createRateLimiter } from '../../src/middleware/rateLimit.js';

describe('Rate limiter middleware (src/middleware/rateLimit.ts)', () => {
  it('allows requests within limit and returns 429 + Retry-After on exhaustion', async () => {
    const limit = 5;
    const app = express();
    app.use(
      createRateLimiter({
        limit,
        instanceCount: 1,
        windowMs: 60_000,
        keyGenerator: () => 'fixed-test-client',
      })
    );
    app.get('/test', (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);

    // Consume the 5 tokens
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    }

    // 6th request (N+1) must be rejected with 429
    const rejected = await request(app).get('/test');
    expect(rejected.status).toBe(429);
    expect(rejected.body.error.code).toBe('RATE_LIMITED');
    expect(rejected.headers['retry-after']).toBeDefined();
    expect(Number(rejected.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('halves effective per-instance limit when INSTANCE_COUNT=2 (D43)', async () => {
    const limit = 6;
    const instanceCount = 2; // effective limit should be 6 / 2 = 3
    const app = express();

    app.use(
      createRateLimiter({
        limit,
        instanceCount,
        windowMs: 60_000,
        keyGenerator: () => 'test-instance-count-client',
      })
    );
    app.get('/test', (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);

    // Should allow exactly 3 requests
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    }

    // 4th request must be rejected
    const rejected = await request(app).get('/test');
    expect(rejected.status).toBe(429);
    expect(rejected.body.error.code).toBe('RATE_LIMITED');
  });

  it('isolates different keys so client A does not starve client B', async () => {
    const app = express();
    app.use(
      createRateLimiter({
        limit: 2,
        keyGenerator: (req) => req.headers['x-client-id'] as string,
      })
    );
    app.get('/test', (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);

    // Exhaust client A
    await request(app).get('/test').set('x-client-id', 'client-a');
    await request(app).get('/test').set('x-client-id', 'client-a');
    const aRejected = await request(app).get('/test').set('x-client-id', 'client-a');
    expect(aRejected.status).toBe(429);

    // Client B should still be allowed
    const bAllowed = await request(app).get('/test').set('x-client-id', 'client-b');
    expect(bAllowed.status).toBe(200);
  });
});
