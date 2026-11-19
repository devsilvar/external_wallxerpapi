import { Router } from 'express';
import type { Config } from '../config.js';

export const API_VERSION = '0.1.0';

export function createMetaRouter(config: Config): Router {
  const router = Router();

  /**
   * Public metadata endpoint returning service version, environment,
   * OpenAPI spec route, and optional docs URL.
   */
  router.get('/meta', (_req, res) => {
    res.status(200).json({
      data: {
        version: API_VERSION,
        environment: config.NODE_ENV,
        specUrl: '/openapi.json',
        docsUrl: config.EXTERNAL_DOCS_URL ?? null,
      },
    });
  });

  return router;
}
