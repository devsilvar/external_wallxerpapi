import express, { Router, type Express, type RequestHandler } from 'express';
import * as helmetNs from 'helmet';
import type { Config } from './config.js';
import { authenticatePartner } from './middleware/authenticatePartner.js';
import { auditApiMutation } from './middleware/auditApiMutation.js';
import { trackApiUsage } from './middleware/trackApiUsage.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createCorsMiddleware } from './middleware/cors.js';
import { requestLogger } from './middleware/logger.js';
import { createRateLimiter, tokenKeyGenerator } from './middleware/rateLimit.js';
import { requestId } from './middleware/requestId.js';
import { requireAccountActive } from './middleware/requireAccountActive.js';
import { requireApiEnabled } from './middleware/requireApiEnabled.js';
import { requirePlatformActive } from './middleware/requirePlatformActive.js';
import { resolveAccountByPartner } from './middleware/resolveAccountByPartner.js';
import { accountsRouter, onboardingHandler } from './routes/accounts.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { adminAuthRouter } from './routes/admin-auth.routes.js';
import { portalAuthRouter } from './routes/portal-auth.routes.js';
import { portalKeysRouter } from './routes/portal-keys.routes.js';
import { portalUsageRouter } from './routes/portal-usage.routes.js';
import { customersRouter } from './routes/customers.routes.js';
import { deletionsRouter } from './routes/deletions.routes.js';
import { expensesRouter } from './routes/expenses.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { createMetaRouter } from './routes/meta.routes.js';
import { docsRouter } from './routes/docs.routes.js';
import { invoicesRouter } from './routes/invoices.routes.js';
import { profitRouter } from './routes/profit.routes.js';
import { createPublicRouter } from './routes/public.routes.js';
import { salesRouter } from './routes/sales.routes.js';

// Must be a namespace import + runtime `.default` lookup, not a default import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const helmet: () => RequestHandler = (helmetNs as any).default ?? (helmetNs as any);

export function createApp(config: Config): Express {
  const app = express();

  app.disable('x-powered-by');

  // Must precede any IP-reading middleware, or every caller is attributed to proxy
  app.set('trust proxy', config.TRUST_PROXY);

  app.use(helmet());

  // Before body parser: malformed payloads must still return with request ID
  app.use(requestId);
  app.use(requestLogger);

  // CORS allowlist before body parsing: preflight must be answered immediately
  app.use(createCorsMiddleware(config.EXTERNAL_CORS_ORIGINS));

  // 1 MB payload limit
  app.use(express.json({ limit: '1mb' }));

  // Ahead of the kill switch: a disabled API must still answer health probe, docs, and meta
  app.use(healthRouter);
  app.use(createMetaRouter(config));
  app.use(docsRouter);

  // Kill-switch layer 1 (503 API_DISABLED)
  app.use('/api', requireApiEnabled(config));

  // V1 API Router: base path /api/external/v1
  const v1Router = Router();

  // Public unauthenticated routes (e.g. /public/invoices/:shareToken/pdf)
  const publicRouter = createPublicRouter(config);
  v1Router.use('/public', publicRouter);
  app.use('/public', publicRouter);

  // Admin surface routes (/admin/*)
  v1Router.use('/admin/auth', adminAuthRouter);
  v1Router.use('/admin', adminRouter);
  app.use('/admin/auth', adminAuthRouter);
  app.use('/admin', adminRouter);

  // Developer portal routes (/portal/*)
  v1Router.use('/portal/keys', portalKeysRouter);
  v1Router.use('/portal/usage', portalUsageRouter);
  v1Router.use('/portal', portalAuthRouter);
  app.use('/portal/keys', portalKeysRouter);
  app.use('/portal/usage', portalUsageRouter);
  app.use('/portal', portalAuthRouter);

  // Partner customer onboarding endpoint: POST /api/external/v1/accounts
  // Authenticated by partner Platform API Key and gated by platform active status
  v1Router.post(
    '/accounts',
    authenticatePartner,
    trackApiUsage,
    createRateLimiter({
      limit: config.EXTERNAL_DATA_RATE_LIMIT,
      instanceCount: config.INSTANCE_COUNT,
      windowMs: 60_000,
      keyGenerator: tokenKeyGenerator,
    }),
    requirePlatformActive,
    onboardingHandler
  );

  // Data routes pipeline: scoped under /accounts/:accountId
  const accountRouter = Router({ mergeParams: true });
  accountRouter.use(
    authenticatePartner,
trackApiUsage,
    createRateLimiter({
      limit: config.EXTERNAL_DATA_RATE_LIMIT,
      instanceCount: config.INSTANCE_COUNT,
      windowMs: 60_000,
      keyGenerator: tokenKeyGenerator,
    }),
    resolveAccountByPartner,
    requirePlatformActive,
auditApiMutation,
    requireAccountActive
  );

  // Probe endpoint to verify the middleware chain for tests
  accountRouter.get('/ping', (_req, res) => {
    res.status(200).json({ data: { ok: true } });
  });

  // Mount scoped resource routers
  accountRouter.use('/customers', customersRouter);
  accountRouter.use('/sales', salesRouter);
  accountRouter.use('/expenses', expensesRouter);
  accountRouter.use('/invoices', invoicesRouter);
  accountRouter.use('/deletions', deletionsRouter);
  accountRouter.use('/', profitRouter);
  accountRouter.use('/', accountsRouter);

  v1Router.use('/accounts/:accountId', accountRouter);
  app.use('/api/external/v1', v1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
