import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../lib/errors.js';
import { hashToken } from '../lib/token.js';

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export interface RateLimiterOptions {
  /**
   * Function to extract the rate limit key from the request (e.g. IP or API key hash).
   * Returning undefined skips rate limiting for this request.
   */
  keyGenerator: (req: Request) => string | undefined;

  /**
   * Total requests allowed per minute across the platform.
   */
  limit: number;

  /**
   * Number of running replicas. The effective limit per instance is limit / instanceCount.
   */
  instanceCount?: number;

  /**
   * Window duration in milliseconds. Defaults to 60,000 ms (1 minute).
   */
  windowMs?: number;
}

/**
 * In-memory token bucket rate limiter.
 *
 * NOTE (D43): In-memory buckets are per-instance. The effective per-instance ceiling
 * is the configured limit divided by INSTANCE_COUNT. This approximation prevents
 * multi-replica clusters from multiplying partner quotas.
 */
export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  const windowMs = options.windowMs ?? 60_000;
  const instanceCount = Math.max(1, options.instanceCount ?? 1);
  const effectiveLimit = Math.max(1, Math.floor(options.limit / instanceCount));

  // In-memory bucket store keyed by extracted key
  const buckets = new Map<string, Bucket>();

  // Prune buckets that have been inactive for over 2 windows to prevent memory leaks
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      if (now - bucket.lastRefill > windowMs * 2) {
        buckets.delete(key);
      }
    }
  }, windowMs * 2);

  // Allow node to exit without being blocked by this timer
  cleanupInterval.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = options.keyGenerator(req);
    if (!key) {
      return next();
    }

    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket) {
      bucket = { tokens: effectiveLimit, lastRefill: now };
      buckets.set(key, bucket);
    } else {
      // Refill tokens proportionally to elapsed time
      const elapsed = now - bucket.lastRefill;
      const refill = (elapsed / windowMs) * effectiveLimit;
      bucket.tokens = Math.min(effectiveLimit, bucket.tokens + refill);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      const remaining = Math.floor(bucket.tokens);
      const missingTokens = effectiveLimit - bucket.tokens;
      const secondsUntilFull = Math.max(
        0,
        Math.ceil((missingTokens / effectiveLimit) * (windowMs / 1000))
      );

      res.setHeader('RateLimit-Limit', String(effectiveLimit));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader('RateLimit-Reset', String(secondsUntilFull));

      return next();
    }

    // Rate limit exhausted: calculate seconds until at least 1 token is available
    const missingTokens = 1 - bucket.tokens;
    const timeToWaitMs = (missingTokens / effectiveLimit) * windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil(timeToWaitMs / 1000));

    res.setHeader('Retry-After', String(retryAfterSeconds));

    return next(
      new AppError(429, 'RATE_LIMITED', 'Rate limit exceeded, please retry later', {
        retryAfter: retryAfterSeconds,
      })
    );
  };
}

export function tokenKeyGenerator(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const raw = auth.slice(7).trim();
    return raw ? hashToken(raw) : undefined;
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function ipKeyGenerator(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}
