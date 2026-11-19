import type { Request, Response, NextFunction, RequestHandler } from 'express';

const EXPOSED_HEADERS = [
  'X-Request-Id',
  'Retry-After',
  'RateLimit-Limit',
  'RateLimit-Remaining',
  'RateLimit-Reset',
].join(', ');

const ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'Authorization, Content-Type, Idempotency-Key';
const MAX_AGE_SECONDS = '600';

/**
 * Origin-allowlist CORS middleware.
 *
 * Rules:
 * 1. An incoming request with an `Origin` matching `allowedOrigins` receives
 *    Access-Control-Allow-Origin, Vary: Origin, and exposed headers.
 * 2. Preflight `OPTIONS` requests from an allowed origin receive allow methods/headers
 *    and terminate immediately with HTTP 204 without calling next().
 * 3. Requests without an Origin or with a non-allowlisted Origin proceed with
 *    no CORS headers set (deny-by-default for browsers; non-browser clients unaffected).
 */
export function createCorsMiddleware(allowedOrigins: string[]): RequestHandler {
  const allowedSet = new Set(allowedOrigins.map((origin) => origin.trim().toLowerCase()));

  return (req: Request, res: Response, next: NextFunction): void => {
    const rawOrigin = req.headers.origin;

    if (!rawOrigin || typeof rawOrigin !== 'string') {
      return next();
    }

    const originToMatch = rawOrigin.trim().toLowerCase();

    if (!allowedSet.has(originToMatch)) {
      return next();
    }

    // Origin is allowlisted
    res.setHeader('Access-Control-Allow-Origin', rawOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.setHeader('Access-Control-Max-Age', MAX_AGE_SECONDS);
      res.status(204).end();
      return;
    }

    return next();
  };
}
