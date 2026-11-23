import type { RequestHandler } from 'express';
import { recordApiRequest } from '../db/usage.repo.js';
import { logger } from '../lib/logger.js';

/**
 * Records every authenticated partner API call against the platform's daily
 * usage rollup. Registered immediately after `authenticatePartner`, so it sees
 * the final status of everything downstream — including rate-limit 429s and
 * account-not-found 404s, which are genuine API traffic.
 *
 * Must never fail the request: the write happens after the response has
 * finished and errors are logged, not propagated.
 */
export const trackApiUsage: RequestHandler = (req, res, next) => {
 const platformId = req.platform?.id;
 if (!platformId) {
 next();
 return;
 }

 res.on('finish', () => {
 void recordApiRequest(platformId, res.statusCode >= 400).catch((err) => {
 logger.warn({ err, platformId }, 'failed to record API usage');
 });
 });

 next();
};
