import { Router, type Request, type Response } from 'express';
import { formatPagedResponse, parsePaginationParams } from '../lib/cursor.js';
import { toDateOnly } from '../lib/dates.js';
import { AppError } from '../lib/errors.js';
import { formatMoney } from '../lib/money.js';
import { generateCommercialInvoicePdf } from '../pdf/commercial-invoice.pdf.js';
import {
  cancelInvoiceAction,
  createInvoiceWithValidation,
  fetchInvoices,
  generateInvoicePdfLink,
  getInvoice,
  getInvoiceForPdf,
  issueInvoiceAction,
  markPaidInvoiceAction,
  removeInvoiceAction,
  updateInvoiceWithValidation,
} from '../services/invoice.service.js';
import {
  validateCreateInvoice,
  validateMarkPaid,
  validateUpdateInvoice,
} from '../validators/invoice.validator.js';

export const invoicesRouter = Router({ mergeParams: true });

function formatInvoiceResponse(invoice: {
  id: string;
  externalRef: string;
  invoiceNumber: string;
  status: string;
  issueDate: Date;
  dueDate: Date;
  customerName: string;
  customerId: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  customerTaxId: string | null;
  subtotal: Parameters<typeof formatMoney>[0];
  discount: Parameters<typeof formatMoney>[0];
  total: Parameters<typeof formatMoney>[0];
  currency: string;
  notes: string | null;
  paymentTerms: string | null;
  sentAt: Date | null;
  paidAt: Date | null;
  paymentMethod: string | null;
  linkedSaleId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lines?: Array<{
    id: string;
    description: string;
    quantity: Parameters<typeof formatMoney>[0];
    unitPrice: Parameters<typeof formatMoney>[0];
    lineTotal: Parameters<typeof formatMoney>[0];
    sortOrder: number;
  }>;
}) {
  return {
    id: invoice.id,
    externalRef: invoice.externalRef,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    issueDate: toDateOnly(invoice.issueDate),
    dueDate: toDateOnly(invoice.dueDate),
    customerName: invoice.customerName,
    customerId: invoice.customerId,
    customerEmail: invoice.customerEmail,
    customerPhone: invoice.customerPhone,
    customerAddress: invoice.customerAddress,
    customerTaxId: invoice.customerTaxId,
    subtotal: formatMoney(invoice.subtotal),
    discount: formatMoney(invoice.discount),
    total: formatMoney(invoice.total),
    currency: invoice.currency,
    notes: invoice.notes,
    paymentTerms: invoice.paymentTerms,
    sentAt: invoice.sentAt ? invoice.sentAt.toISOString() : null,
    paidAt: invoice.paidAt ? invoice.paidAt.toISOString() : null,
    paymentMethod: invoice.paymentMethod,
    linkedSaleId: invoice.linkedSaleId,
    lines: (invoice.lines || []).map((l) => ({
      id: l.id,
      description: l.description,
      quantity: formatMoney(l.quantity),
      unitPrice: formatMoney(l.unitPrice),
      lineTotal: formatMoney(l.lineTotal),
      sortOrder: l.sortOrder,
    })),
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

// GET /accounts/:accountId/invoices
invoicesRouter.get('/', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const { limit, cursor, updatedSince } = parsePaginationParams(req.query);
  const invoices = await fetchInvoices(businessId, {
    updatedSince: updatedSince ?? undefined,
    cursor,
    limit,
  });
  const paged = formatPagedResponse(invoices, limit);

  res.status(200).json({
    data: paged.data.map(formatInvoiceResponse),
    page: paged.page,
  });
});

// POST /accounts/:accountId/invoices
invoicesRouter.post('/', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const input = validateCreateInvoice(req.body);
  const result = await createInvoiceWithValidation(businessId, input);

  const statusCode = result.isReplay ? 200 : 201;
  res.status(statusCode).json({ data: formatInvoiceResponse(result.invoice) });
});

// GET /accounts/:accountId/invoices/:id
invoicesRouter.get('/:id', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const id = req.params['id'];
  if (!id || typeof id !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  const invoice = await getInvoice(businessId, id);
  res.status(200).json({ data: formatInvoiceResponse(invoice) });
});

// PUT /accounts/:accountId/invoices/:id
invoicesRouter.put('/:id', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const id = req.params['id'];
  if (!id || typeof id !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  const input = validateUpdateInvoice(req.body);
  const updated = await updateInvoiceWithValidation(businessId, id, input);

  res.status(200).json({ data: formatInvoiceResponse(updated) });
});

// DELETE /accounts/:accountId/invoices/:id
invoicesRouter.delete('/:id', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const id = req.params['id'];
  if (!id || typeof id !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  await removeInvoiceAction(businessId, id);
  res.status(200).json({ data: { deleted: true } });
});

// POST /accounts/:accountId/invoices/:id/issue
invoicesRouter.post('/:id/issue', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const id = req.params['id'];
  if (!id || typeof id !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  const invoice = await issueInvoiceAction(businessId, id);
  res.status(200).json({ data: formatInvoiceResponse(invoice) });
});

// POST /accounts/:accountId/invoices/:id/send (Alias for /issue)
invoicesRouter.post('/:id/send', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const id = req.params['id'];
  if (!id || typeof id !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  const invoice = await issueInvoiceAction(businessId, id);
  res.status(200).json({ data: formatInvoiceResponse(invoice) });
});

// POST /accounts/:accountId/invoices/:id/mark-paid
invoicesRouter.post('/:id/mark-paid', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const id = req.params['id'];
  if (!id || typeof id !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  const input = validateMarkPaid(req.body);
  const invoice = await markPaidInvoiceAction(businessId, id, input);

  res.status(200).json({ data: formatInvoiceResponse(invoice) });
});

// POST /accounts/:accountId/invoices/:id/cancel
invoicesRouter.post('/:id/cancel', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const id = req.params['id'];
  if (!id || typeof id !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  const invoice = await cancelInvoiceAction(businessId, id);
  res.status(200).json({ data: formatInvoiceResponse(invoice) });
});

// GET /accounts/:accountId/invoices/:id/pdf
invoicesRouter.get('/:id/pdf', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const id = req.params['id'];
  if (!id || typeof id !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  const { invoice, business } = await getInvoiceForPdf(businessId, id);
  const pdfBuffer = await generateCommercialInvoicePdf(invoice, business);

  const disposition = req.query['disposition'] === 'inline' ? 'inline' : 'attachment';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="${invoice.invoiceNumber}.pdf"`);
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');

  res.status(200).send(pdfBuffer);
});

// GET /accounts/:accountId/invoices/:id/pdf-link
invoicesRouter.get('/:id/pdf-link', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const id = req.params['id'];
  if (!id || typeof id !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  const link = await generateInvoicePdfLink(businessId, id);
  res.status(200).json({ data: link });
});

// POST /accounts/:accountId/invoices/:id/pdf-link
invoicesRouter.post('/:id/pdf-link', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const id = req.params['id'];
  if (!id || typeof id !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  const link = await generateInvoicePdfLink(businessId, id);
  res.status(200).json({ data: link });
});
