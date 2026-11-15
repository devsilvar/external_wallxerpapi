import crypto from 'node:crypto';
import { loadConfig } from '../config.js';
import {
  cancelInvoice,
  createInvoice,
  deleteInvoice,
  findBusiness,
  findInvoice,
  findInvoiceByExternalRef,
  findInvoiceByShareToken,
  listInvoices,
  markInvoicePaidAndCreateSale,
  markInvoiceSent,
  setInvoiceShareToken,
  updateInvoice,
  type CreateInvoiceInput,
  type CreateInvoiceLineInput,
  type InvoicePaymentMethod,
  type ListOptions,
} from '../db/scoped.js';
import { parseDateOnly, toDateOnly } from '../lib/dates.js';
import { AppError } from '../lib/errors.js';
import { formatMoney, parseMoney } from '../lib/money.js';
import { type CreateInvoiceDto, type MarkPaidDto, type UpdateInvoiceDto } from '../validators/invoice.validator.js';
import { checkIdempotency, hashCanonicalPayload } from './idempotency.js';
import { nextInvoiceNumber } from './sequence.service.js';

export async function getInvoice(businessId: string, id: string) {
  const invoice = await findInvoice(businessId, id);
  if (!invoice) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }
  return invoice;
}

export async function fetchInvoices(businessId: string, options?: ListOptions) {
  return listInvoices(businessId, options);
}

export async function createInvoiceWithValidation(
  businessId: string,
  input: CreateInvoiceDto
) {
  // 1. Check idempotency by externalRef
  const existing = await findInvoiceByExternalRef(businessId, input.externalRef);

  // Compute line items totals
  let subtotal = parseMoney(0);
  const validatedLines: CreateInvoiceLineInput[] = input.lines.map((line, idx) => {
    const qty = parseMoney(line.quantity);
    const unitPrice = parseMoney(line.unitPrice);
    const lineTotal = parseMoney(qty.mul(unitPrice));
    subtotal = parseMoney(subtotal.add(lineTotal));

    return {
      description: line.description,
      quantity: qty.toFixed(2),
      unitPrice: unitPrice.toFixed(2),
      lineTotal: lineTotal.toFixed(2),
      sortOrder: line.sortOrder ?? idx,
    };
  });

  const discount = parseMoney(input.discount ?? '0.00');

  // P5-02 The discount bound: discount cannot exceed subtotal
  if (discount.gt(subtotal)) {
    throw new AppError(
      400,
      'INVALID_DISCOUNT',
      `Discount (${formatMoney(discount)}) cannot exceed subtotal (${formatMoney(subtotal)})`
    );
  }

  const total = parseMoney(subtotal.sub(discount));

  const canonicalInput = {
    externalRef: input.externalRef,
    customerName: input.customerName,
    customerId: input.customerId ?? null,
    customerEmail: input.customerEmail ?? null,
    customerPhone: input.customerPhone ?? null,
    customerAddress: input.customerAddress ?? null,
    customerTaxId: input.customerTaxId ?? null,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    discount: formatMoney(discount),
    currency: 'NGN',
    notes: input.notes ?? null,
    paymentTerms: input.paymentTerms ?? null,
    lines: validatedLines.map((l) => ({
      description: l.description,
      quantity: formatMoney(l.quantity),
      unitPrice: formatMoney(l.unitPrice),
      lineTotal: formatMoney(l.lineTotal),
      sortOrder: l.sortOrder,
    })),
  };
  const payloadHash = hashCanonicalPayload(canonicalInput);

  if (existing) {
    const existingCanonical = {
      externalRef: existing.externalRef,
      customerName: existing.customerName,
      customerId: existing.customerId,
      customerEmail: existing.customerEmail,
      customerPhone: existing.customerPhone,
      customerAddress: existing.customerAddress,
      customerTaxId: existing.customerTaxId,
      issueDate: existing.issueDate.toISOString().slice(0, 10),
      dueDate: existing.dueDate.toISOString().slice(0, 10),
      discount: formatMoney(existing.discount),
      currency: existing.currency,
      notes: existing.notes,
      paymentTerms: existing.paymentTerms,
      lines: existing.lines.map((l) => ({
        description: l.description,
        quantity: formatMoney(l.quantity),
        unitPrice: formatMoney(l.unitPrice),
        lineTotal: formatMoney(l.lineTotal),
        sortOrder: l.sortOrder,
      })),
    };
    const existingCanonicalHash = hashCanonicalPayload(existingCanonical);

    const check = checkIdempotency(existing, payloadHash, existingCanonicalHash);
    return {
      invoice: check.record!,
      isReplay: true,
    };
  }

  // Mint invoice number from sequence allocator (P1-06)
  const issueDateObj = parseDateOnly(input.issueDate);
  const year = issueDateObj.getUTCFullYear();
  let invoiceNumber = await nextInvoiceNumber(businessId, year);

  const createData: CreateInvoiceInput = {
    externalRef: input.externalRef,
    invoiceNumber,
    issueDate: issueDateObj,
    dueDate: parseDateOnly(input.dueDate),
    customerName: input.customerName,
    customerId: input.customerId,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    customerAddress: input.customerAddress,
    customerTaxId: input.customerTaxId,
    subtotal: subtotal.toFixed(2),
    discount: discount.toFixed(2),
    total: total.toFixed(2),
    currency: 'NGN',
    notes: input.notes,
    paymentTerms: input.paymentTerms,
    lines: validatedLines,
  };

  try {
    const created = await createInvoice(businessId, createData);
    return {
      invoice: created,
      isReplay: false,
    };
  } catch (err: unknown) {
    // If unique collision on invoiceNumber, retry once with a freshly minted number
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
      invoiceNumber = await nextInvoiceNumber(businessId, year);
      const retried = await createInvoice(businessId, {
        ...createData,
        invoiceNumber,
      });
      return {
        invoice: retried,
        isReplay: false,
      };
    }
    throw err;
  }
}

export async function updateInvoiceWithValidation(
  businessId: string,
  id: string,
  input: UpdateInvoiceDto
) {
  const existing = await findInvoice(businessId, id);
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  // P5-03: PUT is draft-only
  if (existing.status !== 'draft') {
    throw new AppError(409, 'INVOICE_NOT_EDITABLE', 'Only draft invoices can be updated');
  }

  let subtotal = parseMoney(existing.subtotal);
  let validatedLines: CreateInvoiceLineInput[] | undefined;

  if (input.lines && input.lines.length > 0) {
    subtotal = parseMoney(0);
    validatedLines = input.lines.map((line, idx) => {
      const qty = parseMoney(line.quantity);
      const unitPrice = parseMoney(line.unitPrice);
      const lineTotal = parseMoney(qty.mul(unitPrice));
      subtotal = parseMoney(subtotal.add(lineTotal));

      return {
        description: line.description,
        quantity: qty.toFixed(2),
        unitPrice: unitPrice.toFixed(2),
        lineTotal: lineTotal.toFixed(2),
        sortOrder: line.sortOrder ?? idx,
      };
    });
  }

  const discount = input.discount !== undefined
    ? parseMoney(input.discount)
    : parseMoney(existing.discount);

  // P5-02 The discount bound: discount cannot exceed subtotal
  if (discount.gt(subtotal)) {
    throw new AppError(
      400,
      'INVALID_DISCOUNT',
      `Discount (${formatMoney(discount)}) cannot exceed subtotal (${formatMoney(subtotal)})`
    );
  }

  const total = parseMoney(subtotal.sub(discount));

  const updated = await updateInvoice(businessId, id, {
    customerName: input.customerName,
    customerId: input.customerId,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    customerAddress: input.customerAddress,
    customerTaxId: input.customerTaxId,
    dueDate: input.dueDate ? parseDateOnly(input.dueDate) : undefined,
    subtotal: subtotal.toFixed(2),
    discount: discount.toFixed(2),
    total: total.toFixed(2),
    notes: input.notes,
    paymentTerms: input.paymentTerms,
    lines: validatedLines,
  });

  return updated;
}

export async function issueInvoiceAction(businessId: string, id: string) {
  const existing = await findInvoice(businessId, id);
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  // Already sent -> 200 idempotent
  if (existing.status === 'sent') {
    return existing;
  }

  if (existing.status !== 'draft') {
    throw new AppError(
      409,
      'INVOICE_NOT_EDITABLE',
      `Cannot issue invoice in ${existing.status} status`
    );
  }

  return markInvoiceSent(businessId, id);
}

export async function markPaidInvoiceAction(
  businessId: string,
  id: string,
  input: MarkPaidDto
) {
  const existing = await findInvoice(businessId, id);
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  if (existing.status === 'draft') {
    throw new AppError(
      409,
      'INVOICE_NOT_SENT',
      'Invoice must be in sent status before marking as paid'
    );
  }

  if (existing.status === 'cancelled') {
    throw new AppError(
      409,
      'INVOICE_CANCELLED',
      'Cancelled invoice cannot be marked as paid'
    );
  }

  // Already paid -> 200 idempotent
  if (existing.status === 'paid') {
    return existing;
  }

  // Validate payment date: issueDate <= paymentDate <= today
  const issueDateStr = toDateOnly(existing.issueDate);
  const todayStr = toDateOnly(new Date());
  const paymentDateStr = input.paymentDate ? input.paymentDate : todayStr;

  if (paymentDateStr > todayStr) {
    throw new AppError(400, 'INVALID_DATE', 'Payment date cannot be in the future');
  }
  if (paymentDateStr < issueDateStr) {
    throw new AppError(400, 'INVALID_DATE', 'Payment date cannot be before invoice issue date');
  }

  const paymentDateObj = parseDateOnly(paymentDateStr);

  return markInvoicePaidAndCreateSale(businessId, id, {
    paymentDate: paymentDateObj,
    paymentMethod: input.paymentMethod as InvoicePaymentMethod,
  });
}

export async function cancelInvoiceAction(businessId: string, id: string) {
  const existing = await findInvoice(businessId, id);
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  if (existing.status === 'paid') {
    throw new AppError(409, 'INVOICE_PAID', 'Paid invoices cannot be cancelled');
  }

  if (existing.status === 'cancelled') {
    return existing;
  }

  return cancelInvoice(businessId, id);
}

export async function removeInvoiceAction(businessId: string, id: string) {
  const existing = await findInvoice(businessId, id);
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  if (existing.status !== 'draft') {
    throw new AppError(
      409,
      'INVOICE_NOT_DELETABLE',
      'Only draft invoices can be deleted'
    );
  }

  return deleteInvoice(businessId, id);
}

export async function generateInvoicePdfLink(businessId: string, id: string) {
  const existing = await findInvoice(businessId, id);
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  const config = loadConfig();
  const ttlDays = config.EXTERNAL_SHARE_TOKEN_TTL_DAYS || 30;
  const shareToken = crypto.randomBytes(32).toString('hex');
  const shareTokenExpiresAt = new Date(Date.now() + ttlDays * 86400 * 1000);

  // Minting replaces any previous token and kills old one immediately
  await setInvoiceShareToken(businessId, id, shareToken, shareTokenExpiresAt);

  return {
    pdfUrl: `/api/external/v1/public/invoices/${shareToken}/pdf`,
    expiresAt: shareTokenExpiresAt.toISOString(),
  };
}

export async function getPublicInvoiceByShareToken(shareToken: string) {
  const invoice = await findInvoiceByShareToken(shareToken);
  if (!invoice) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  // Expired -> 404 (indistinguishable by design)
  if (invoice.shareTokenExpiresAt && invoice.shareTokenExpiresAt < new Date()) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  // Cancelled -> 410 INVOICE_CANCELLED
  if (invoice.status === 'cancelled') {
    throw new AppError(410, 'INVOICE_CANCELLED', 'Invoice has been cancelled');
  }

  return invoice;
}

export async function getInvoiceForPdf(businessId: string, id: string) {
  const invoice = await findInvoice(businessId, id);
  if (!invoice) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  if (invoice.status === 'cancelled') {
    throw new AppError(410, 'INVOICE_CANCELLED', 'Invoice has been cancelled');
  }

  const business = await findBusiness(businessId);
  if (!business) {
    throw new AppError(404, 'NOT_FOUND', 'Business not found');
  }

  return {
    invoice,
    business,
  };
}
