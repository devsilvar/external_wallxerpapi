import { Router, type Request, type Response } from 'express';
import type { Config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { generateCommercialInvoicePdf } from '../pdf/commercial-invoice.pdf.js';
import { getPublicInvoiceByShareToken } from '../services/invoice.service.js';

export function createPublicRouter(config: Config): Router {
  const router = Router({ mergeParams: true });

  const ipLimiter = createRateLimiter({
    limit: config.EXTERNAL_PUBLIC_PDF_RATE_LIMIT,
    instanceCount: config.INSTANCE_COUNT,
    windowMs: 60_000,
    keyGenerator: (req) => req.ip || 'unknown',
  });

  const tokenLimiter = createRateLimiter({
    limit: config.EXTERNAL_PUBLIC_PDF_RATE_LIMIT,
    instanceCount: config.INSTANCE_COUNT,
    windowMs: 60_000,
    keyGenerator: (req) => {
      const token = req.params['shareToken'];
      return token ? `share_token:${token}` : undefined;
    },
  });

  // GET /public/invoices/:shareToken/pdf
  router.get(
    '/invoices/:shareToken/pdf',
    ipLimiter,
    tokenLimiter,
    async (req: Request, res: Response) => {
      const shareToken = req.params['shareToken'];
      if (!shareToken || typeof shareToken !== 'string') {
        throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
      }

      const invoice = await getPublicInvoiceByShareToken(shareToken);
      const pdfBuffer = await generateCommercialInvoicePdf(invoice, invoice.business);

      const disposition = req.query['disposition'] === 'inline' ? 'inline' : 'attachment';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${disposition}; filename="${invoice.invoiceNumber}.pdf"`);
      res.setHeader('Cache-Control', 'private, max-age=60');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');

      res.status(200).send(pdfBuffer);
    }
  );

  return router;
}
