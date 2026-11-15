import { Prisma } from '@prisma/client';
import type {
  Business,
  Customer,
  Expense,
  ExpenseCategory,
  Invoice,
  InvoicePaymentMethod,
  SalesSource,
  SalesTransaction,
  TransactionStatus,
  ExternalTombstone,
  AuditLog,
} from '@prisma/client';
import { prisma, Decimal } from './client.js';
import { nextMerchantId } from './sequence.repo.js';
import { AppError } from '../lib/errors.js';
import { buildKeysetClause, type CursorPayload } from '../lib/cursor.js';

export { Decimal };
export type {
  Business,
  Customer,
  Expense,
  ExpenseCategory,
  Invoice,
  InvoicePaymentMethod,
  SalesSource,
  SalesTransaction,
  TransactionStatus,
  ExternalTombstone,
  AuditLog,
};

export interface ListOptions {
  updatedSince?: Date;
  cursor?: CursorPayload | null;
  limit?: number;
}

const TX_OPTIONS = { maxWait: 10000, timeout: 20000 };

// -----------------------------------------------------------------------------
// 1. BUSINESS (ACCOUNT) SCOPED OPERATIONS
// -----------------------------------------------------------------------------

export interface UpdateBusinessInput {
  businessName?: string;
  ownerName?: string;
  businessType?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

export async function findBusiness(businessId: string): Promise<Business | null> {
  return prisma.business.findUnique({
    where: { id: businessId },
  });
}

export async function updateBusiness(
  businessId: string,
  data: UpdateBusinessInput
): Promise<Business> {
  const existing = await prisma.business.findUnique({
    where: { id: businessId },
  });
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Account not found');
  }

  // Strict whitelist of merchant-editable fields (D42)
  const safeData: Prisma.BusinessUpdateInput = {};
  if (data.businessName !== undefined) safeData.businessName = data.businessName;
  if (data.ownerName !== undefined) safeData.ownerName = data.ownerName;
  if (data.businessType !== undefined) safeData.businessType = data.businessType;
  if (data.address !== undefined) safeData.address = data.address;
  if (data.city !== undefined) safeData.city = data.city;
  if (data.state !== undefined) safeData.state = data.state;
  if (data.contactPhone !== undefined) safeData.contactPhone = data.contactPhone;
  if (data.contactEmail !== undefined) safeData.contactEmail = data.contactEmail;

  return prisma.business.update({
    where: { id: businessId },
    data: safeData,
  });
}

// -----------------------------------------------------------------------------
// 2. CUSTOMER SCOPED OPERATIONS
// -----------------------------------------------------------------------------

export interface CreateCustomerInput {
  externalId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  taxId?: string | null;
  notes?: string | null;
}

export interface UpdateCustomerInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  taxId?: string | null;
  notes?: string | null;
}

export async function findCustomer(businessId: string, id: string): Promise<Customer | null> {
  return prisma.customer.findFirst({
    where: { id, businessId },
  });
}

export async function findCustomerByExternalId(
  businessId: string,
  externalId: string
): Promise<Customer | null> {
  return prisma.customer.findUnique({
    where: {
      businessId_externalId: {
        businessId,
        externalId,
      },
    },
  });
}

export async function listCustomers(
  businessId: string,
  options?: ListOptions
): Promise<Customer[]> {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
  const updatedSince = options?.updatedSince;
  const keysetClause = buildKeysetClause(options?.cursor, !!updatedSince);

  return prisma.customer.findMany({
    where: {
      businessId,
      ...(updatedSince ? { updatedAt: { gte: updatedSince } } : {}),
      ...(keysetClause ? keysetClause : {}),
    },
    take: limit + 1,
    orderBy: updatedSince
      ? [{ updatedAt: 'asc' }, { id: 'asc' }]
      : [{ updatedAt: 'desc' }, { id: 'desc' }],
  });
}

export async function createCustomer(
  businessId: string,
  data: CreateCustomerInput
): Promise<Customer> {
  return prisma.customer.create({
    data: {
      businessId,
      externalId: data.externalId,
      name: data.name,
      email: data.email ?? null,
      phone: data.phone ?? null,
      address: data.address ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      taxId: data.taxId ?? null,
      notes: data.notes ?? null,
    },
  });
}

export async function reactivateCustomer(
  businessId: string,
  id: string,
  data: CreateCustomerInput
): Promise<Customer> {
  const existing = await prisma.customer.findFirst({
    where: { id, businessId },
  });
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }

  return prisma.customer.update({
    where: { id: existing.id },
    data: {
      isActive: true,
      name: data.name,
      email: data.email ?? null,
      phone: data.phone ?? null,
      address: data.address ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      taxId: data.taxId ?? null,
      notes: data.notes ?? null,
    },
  });
}

export async function updateCustomer(
  businessId: string,
  id: string,
  data: UpdateCustomerInput
): Promise<Customer> {
  const existing = await prisma.customer.findFirst({
    where: { id, businessId },
  });
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }

  return prisma.customer.update({
    where: { id: existing.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.address !== undefined ? { address: data.address } : {}),
      ...(data.city !== undefined ? { city: data.city } : {}),
      ...(data.state !== undefined ? { state: data.state } : {}),
      ...(data.taxId !== undefined ? { taxId: data.taxId } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
    },
  });
}

export async function deleteCustomer(businessId: string, id: string): Promise<void> {
  const existing = await prisma.customer.findFirst({
    where: { id, businessId },
  });
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }

  await prisma.$transaction(async (tx) => {
    // Soft delete customer
    await tx.customer.update({
      where: { id: existing.id },
      data: { isActive: false },
    });

    // Create tombstone for sync
    await tx.externalTombstone.create({
      data: {
        businessId,
        entityType: 'customer',
        entityId: existing.id,
      },
    });
  }, TX_OPTIONS);
}

// -----------------------------------------------------------------------------
// 3. SALES TRANSACTION SCOPED OPERATIONS
// -----------------------------------------------------------------------------

export interface CreateSaleLineItemInput {
  name: string;
  quantity: Prisma.Decimal | number | string;
  unitPrice: Prisma.Decimal | number | string;
  lineTotal: Prisma.Decimal | number | string;
  sortOrder?: number;
}

export interface CreateSaleInput {
  referenceId: string;
  amount: Prisma.Decimal | number | string;
  source: SalesSource;
  status?: TransactionStatus;
  transactionDate: Date;
  description?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  metadata?: Record<string, unknown> | Prisma.InputJsonValue;
  items?: CreateSaleLineItemInput[];
}

export async function findSale(
  businessId: string,
  id: string
): Promise<(SalesTransaction & { items: Prisma.SaleLineItemGetPayload<object>[] }) | null> {
  return prisma.salesTransaction.findFirst({
    where: { id, businessId },
    include: {
      items: {
        orderBy: { sortOrder: 'asc' },
      },
    },
  });
}

export async function findSaleByReference(
  businessId: string,
  referenceId: string,
  source?: SalesSource
): Promise<(SalesTransaction & { items: Prisma.SaleLineItemGetPayload<object>[] }) | null> {
  return prisma.salesTransaction.findFirst({
    where: {
      businessId,
      referenceId,
      ...(source ? { source } : {}),
    },
    include: {
      items: {
        orderBy: { sortOrder: 'asc' },
      },
    },
  });
}

export async function listSales(
  businessId: string,
  options?: ListOptions
): Promise<(SalesTransaction & { items: Prisma.SaleLineItemGetPayload<object>[] })[]> {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
  const updatedSince = options?.updatedSince;
  const keysetClause = buildKeysetClause(options?.cursor, !!updatedSince);

  return prisma.salesTransaction.findMany({
    where: {
      businessId,
      ...(updatedSince ? { updatedAt: { gte: updatedSince } } : {}),
      ...(keysetClause ? keysetClause : {}),
    },
    include: {
      items: {
        orderBy: { sortOrder: 'asc' },
      },
    },
    take: limit + 1,
    orderBy: updatedSince
      ? [{ updatedAt: 'asc' }, { id: 'asc' }]
      : [{ updatedAt: 'desc' }, { id: 'desc' }],
  });
}

export async function createSale(
  businessId: string,
  data: CreateSaleInput
): Promise<SalesTransaction & { items: Prisma.SaleLineItemGetPayload<object>[] }> {
  return prisma.$transaction(async (tx) => {
    // If customerId is provided, verify it belongs to this business
    if (data.customerId) {
      const cust = await tx.customer.findFirst({
        where: { id: data.customerId, businessId },
      });
      if (!cust) {
        throw new AppError(404, 'NOT_FOUND', 'Customer not found');
      }
    }

    const sale = await tx.salesTransaction.create({
      data: {
        businessId,
        referenceId: data.referenceId,
        amount: data.amount,
        source: data.source,
        status: data.status ?? 'confirmed',
        transactionDate: data.transactionDate,
        description: data.description ?? null,
        customerId: data.customerId ?? null,
        customerName: data.customerName ?? null,
        metadata: (data.metadata as Prisma.InputJsonValue) ?? undefined,
        // Enforce safe defaults (no tax fields externally modifiable)
        isTaxable: true,
      },
    });

    if (data.items && data.items.length > 0) {
      await tx.saleLineItem.createMany({
        data: data.items.map((item, index) => ({
          saleId: sale.id,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          sortOrder: item.sortOrder ?? index,
        })),
      });
    }

    const completeSale = await tx.salesTransaction.findUnique({
      where: { id: sale.id },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!completeSale) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Failed to retrieve created sale');
    }

    return completeSale;
  }, TX_OPTIONS);
}

export async function deleteSale(businessId: string, id: string): Promise<void> {
  const existing = await prisma.salesTransaction.findFirst({
    where: { id, businessId },
    include: { invoice: true },
  });
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Sale not found');
  }

  // Guard: Sale cannot be deleted if linked to an invoice (Phase 5 / D46)
  if (existing.invoice) {
    throw new AppError(
      409,
      'SALE_LINKED_TO_INVOICE',
      'Sale is linked to an invoice and cannot be deleted'
    );
  }

  await prisma.$transaction(async (tx) => {
    // Delete line items
    await tx.saleLineItem.deleteMany({
      where: { saleId: existing.id },
    });

    // Delete sale
    await tx.salesTransaction.delete({
      where: { id: existing.id },
    });

    // Create tombstone
    await tx.externalTombstone.create({
      data: {
        businessId,
        entityType: 'sale',
        entityId: existing.id,
      },
    });
  }, TX_OPTIONS);
}

// -----------------------------------------------------------------------------
// 4. EXPENSE SCOPED OPERATIONS
// -----------------------------------------------------------------------------

export interface CreateExpenseInput {
  externalRef: string;
  category: ExpenseCategory;
  categoryDetail?: string | null;
  description: string;
  amount: Prisma.Decimal | number | string;
  quantity?: Prisma.Decimal | number | string;
  unitPrice?: Prisma.Decimal | number | string | null;
  expenseDate: Date;
  receiptUrl?: string | null;
}

export async function findExpense(businessId: string, id: string): Promise<Expense | null> {
  return prisma.expense.findFirst({
    where: { id, businessId },
  });
}

export async function findExpenseByExternalRef(
  businessId: string,
  externalRef: string
): Promise<Expense | null> {
  return prisma.expense.findUnique({
    where: {
      businessId_externalRef: {
        businessId,
        externalRef,
      },
    },
  });
}

export async function listExpenses(
  businessId: string,
  options?: ListOptions
): Promise<Expense[]> {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
  const updatedSince = options?.updatedSince;
  const keysetClause = buildKeysetClause(options?.cursor, !!updatedSince);

  return prisma.expense.findMany({
    where: {
      businessId,
      ...(updatedSince ? { updatedAt: { gte: updatedSince } } : {}),
      ...(keysetClause ? keysetClause : {}),
    },
    take: limit + 1,
    orderBy: updatedSince
      ? [{ updatedAt: 'asc' }, { id: 'asc' }]
      : [{ updatedAt: 'desc' }, { id: 'desc' }],
  });
}

export async function createExpense(
  businessId: string,
  data: CreateExpenseInput
): Promise<Expense> {
  return prisma.expense.create({
    data: {
      businessId,
      externalRef: data.externalRef,
      category: data.category,
      categoryDetail: data.categoryDetail ?? null,
      description: data.description,
      amount: data.amount,
      quantity: data.quantity ?? 1,
      unitPrice: data.unitPrice ?? null,
      expenseDate: data.expenseDate,
      receiptUrl: data.receiptUrl ?? null,
      // CRITICAL TAX SAFETY: External expenses are NEVER deductible by default
      isDeductible: false,
    },
  });
}

export async function deleteExpense(businessId: string, id: string): Promise<void> {
  const existing = await prisma.expense.findFirst({
    where: { id, businessId },
  });
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Expense not found');
  }

  await prisma.$transaction(async (tx) => {
    await tx.expense.delete({
      where: { id: existing.id },
    });

    await tx.externalTombstone.create({
      data: {
        businessId,
        entityType: 'expense',
        entityId: existing.id,
      },
    });
  }, TX_OPTIONS);
}

// -----------------------------------------------------------------------------
// 5. INVOICE SCOPED OPERATIONS
// -----------------------------------------------------------------------------

export interface CreateInvoiceLineInput {
  description: string;
  quantity: Prisma.Decimal | number | string;
  unitPrice: Prisma.Decimal | number | string;
  lineTotal: Prisma.Decimal | number | string;
  sortOrder?: number;
}

export interface CreateInvoiceInput {
  externalRef: string;
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  customerName: string;
  customerId?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerTaxId?: string | null;
  subtotal: Prisma.Decimal | number | string;
  discount?: Prisma.Decimal | number | string;
  total: Prisma.Decimal | number | string;
  currency?: string;
  notes?: string | null;
  paymentTerms?: string | null;
  lines: CreateInvoiceLineInput[];
}

export interface UpdateInvoiceInput {
  dueDate?: Date;
  customerName?: string;
  customerId?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerTaxId?: string | null;
  subtotal?: Prisma.Decimal | number | string;
  discount?: Prisma.Decimal | number | string;
  total?: Prisma.Decimal | number | string;
  notes?: string | null;
  paymentTerms?: string | null;
  lines?: CreateInvoiceLineInput[];
}

export async function findInvoice(
  businessId: string,
  id: string
): Promise<(Invoice & { lines: Prisma.InvoiceLineGetPayload<object>[] }) | null> {
  return prisma.invoice.findFirst({
    where: { id, businessId },
    include: {
      lines: {
        orderBy: { sortOrder: 'asc' },
      },
    },
  });
}

export async function findInvoiceByExternalRef(
  businessId: string,
  externalRef: string
): Promise<(Invoice & { lines: Prisma.InvoiceLineGetPayload<object>[] }) | null> {
  return prisma.invoice.findUnique({
    where: {
      businessId_externalRef: {
        businessId,
        externalRef,
      },
    },
    include: {
      lines: {
        orderBy: { sortOrder: 'asc' },
      },
    },
  });
}

export async function listInvoices(
  businessId: string,
  options?: ListOptions
): Promise<(Invoice & { lines: Prisma.InvoiceLineGetPayload<object>[] })[]> {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
  const updatedSince = options?.updatedSince;
  const keysetClause = buildKeysetClause(options?.cursor, !!updatedSince);

  return prisma.invoice.findMany({
    where: {
      businessId,
      ...(updatedSince ? { updatedAt: { gte: updatedSince } } : {}),
      ...(keysetClause ? keysetClause : {}),
    },
    include: {
      lines: {
        orderBy: { sortOrder: 'asc' },
      },
    },
    take: limit + 1,
    orderBy: updatedSince
      ? [{ updatedAt: 'asc' }, { id: 'asc' }]
      : [{ updatedAt: 'desc' }, { id: 'desc' }],
  });
}

export async function createInvoice(
  businessId: string,
  data: CreateInvoiceInput
): Promise<Invoice & { lines: Prisma.InvoiceLineGetPayload<object>[] }> {
  return prisma.$transaction(async (tx) => {
    if (data.customerId) {
      const cust = await tx.customer.findFirst({
        where: { id: data.customerId, businessId },
      });
      if (!cust) {
        throw new AppError(404, 'NOT_FOUND', 'Customer not found');
      }
    }

    const invoice = await tx.invoice.create({
      data: {
        businessId,
        externalRef: data.externalRef,
        invoiceNumber: data.invoiceNumber,
        status: 'draft',
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        customerName: data.customerName,
        customerId: data.customerId ?? null,
        customerEmail: data.customerEmail ?? null,
        customerPhone: data.customerPhone ?? null,
        customerAddress: data.customerAddress ?? null,
        customerTaxId: data.customerTaxId ?? null,
        subtotal: data.subtotal,
        vatRate: 0, // CRITICAL SAFE DEFAULT: Commercial non-fiscal invoice
        vatAmount: 0,
        discount: data.discount ?? 0,
        total: data.total,
        currency: data.currency ?? 'NGN',
        notes: data.notes ?? null,
        paymentTerms: data.paymentTerms ?? null,
      },
    });

    if (data.lines && data.lines.length > 0) {
      await tx.invoiceLine.createMany({
        data: data.lines.map((line, index) => ({
          invoiceId: invoice.id,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
          sortOrder: line.sortOrder ?? index,
        })),
      });
    }

    const completeInvoice = await tx.invoice.findUnique({
      where: { id: invoice.id },
      include: {
        lines: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!completeInvoice) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Failed to retrieve created invoice');
    }

    return completeInvoice;
  }, TX_OPTIONS);
}

export async function updateInvoice(
  businessId: string,
  id: string,
  data: UpdateInvoiceInput
): Promise<Invoice & { lines: Prisma.InvoiceLineGetPayload<object>[] }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findFirst({
      where: { id, businessId },
    });
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
    }
    if (existing.status !== 'draft') {
      throw new AppError(409, 'INVOICE_NOT_EDITABLE', 'Only draft invoices can be updated');
    }

    if (data.customerId) {
      const cust = await tx.customer.findFirst({
        where: { id: data.customerId, businessId },
      });
      if (!cust) {
        throw new AppError(404, 'NOT_FOUND', 'Customer not found');
      }
    }

    await tx.invoice.update({
      where: { id: existing.id },
      data: {
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
        ...(data.customerName !== undefined ? { customerName: data.customerName } : {}),
        ...(data.customerId !== undefined ? { customerId: data.customerId } : {}),
        ...(data.customerEmail !== undefined ? { customerEmail: data.customerEmail } : {}),
        ...(data.customerPhone !== undefined ? { customerPhone: data.customerPhone } : {}),
        ...(data.customerAddress !== undefined ? { customerAddress: data.customerAddress } : {}),
        ...(data.customerTaxId !== undefined ? { customerTaxId: data.customerTaxId } : {}),
        ...(data.subtotal !== undefined ? { subtotal: data.subtotal } : {}),
        ...(data.discount !== undefined ? { discount: data.discount } : {}),
        ...(data.total !== undefined ? { total: data.total } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.paymentTerms !== undefined ? { paymentTerms: data.paymentTerms } : {}),
      },
    });

    if (data.lines) {
      await tx.invoiceLine.deleteMany({
        where: { invoiceId: existing.id },
      });
      await tx.invoiceLine.createMany({
        data: data.lines.map((line, index) => ({
          invoiceId: existing.id,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
          sortOrder: line.sortOrder ?? index,
        })),
      });
    }

    const updated = await tx.invoice.findUnique({
      where: { id: existing.id },
      include: {
        lines: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!updated) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Failed to retrieve updated invoice');
    }

    return updated;
  }, TX_OPTIONS);
}

export async function deleteInvoice(businessId: string, id: string): Promise<void> {
  const existing = await prisma.invoice.findFirst({
    where: { id, businessId },
  });
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  // Only draft invoices can be deleted
  if (existing.status !== 'draft') {
    throw new AppError(
      409,
      'INVOICE_NOT_DELETABLE',
      'Only draft invoices can be deleted'
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoiceLine.deleteMany({
      where: { invoiceId: existing.id },
    });
    await tx.invoice.delete({
      where: { id: existing.id },
    });
    await tx.externalTombstone.create({
      data: {
        businessId,
        entityType: 'invoice',
        entityId: existing.id,
      },
    });
  }, TX_OPTIONS);
}

export async function cancelInvoice(
  businessId: string,
  id: string
): Promise<Invoice> {
  const existing = await prisma.invoice.findFirst({
    where: { id, businessId },
  });
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }
  if (existing.status === 'paid') {
    throw new AppError(409, 'INVOICE_PAID', 'Paid invoices cannot be cancelled');
  }
  if (existing.status === 'cancelled') {
    return existing;
  }

  return prisma.invoice.update({
    where: { id: existing.id },
    data: { status: 'cancelled' },
  });
}

export async function markInvoiceSent(
  businessId: string,
  id: string
): Promise<Invoice> {
  const existing = await prisma.invoice.findFirst({
    where: { id, businessId },
  });
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }
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

  return prisma.invoice.update({
    where: { id: existing.id },
    data: {
      status: 'sent',
      sentAt: new Date(),
    },
  });
}

export async function markInvoicePaid(
  businessId: string,
  id: string,
  linkedSaleId: string,
  paymentMethod?: InvoicePaymentMethod,
  paidAt?: Date
): Promise<Invoice> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findFirst({
      where: { id, businessId },
    });
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
    if (existing.status === 'paid') {
      return existing;
    }

    // Must link to a valid sale owned by THIS business
    const sale = await tx.salesTransaction.findFirst({
      where: { id: linkedSaleId, businessId },
    });
    if (!sale) {
      throw new AppError(404, 'NOT_FOUND', 'Linked sale not found');
    }

    return tx.invoice.update({
      where: { id: existing.id },
      data: {
        status: 'paid',
        paidAt: paidAt ?? new Date(),
        linkedSaleId: sale.id,
        paymentMethod: paymentMethod ?? null,
      },
    });
  }, TX_OPTIONS);
}

export interface MarkPaidOptions {
  paymentDate: Date;
  paymentMethod: InvoicePaymentMethod;
}

export async function markInvoicePaidAndCreateSale(
  businessId: string,
  id: string,
  options: MarkPaidOptions
): Promise<Invoice & { lines: Prisma.InvoiceLineGetPayload<object>[] }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findFirst({
        where: { id, businessId },
        include: {
          lines: { orderBy: { sortOrder: 'asc' } },
        },
      });

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

      if (existing.status === 'paid') {
        return existing;
      }

      // Create linked sale in the same transaction
      const sale = await tx.salesTransaction.create({
        data: {
          businessId,
          amount: existing.total,
          source: 'api',
          status: 'confirmed',
          isTaxable: false,
          referenceId: existing.invoiceNumber,
          transactionDate: options.paymentDate,
          description: `Payment for invoice ${existing.invoiceNumber}`,
          customerId: existing.customerId,
          customerName: existing.customerName,
          metadata: {
            invoiceId: existing.id,
            invoiceNumber: existing.invoiceNumber,
            paymentMethod: options.paymentMethod,
            subtotal: existing.subtotal.toString(),
            vatAmount: '0.00',
            discount: existing.discount.toString(),
          },
        },
      });

      if (existing.lines.length > 0) {
        await tx.saleLineItem.createMany({
          data: existing.lines.map((line, idx) => ({
            saleId: sale.id,
            name: line.description.slice(0, 200),
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: line.lineTotal,
            sortOrder: line.sortOrder ?? idx,
          })),
        });
      }

      const updated = await tx.invoice.update({
        where: { id: existing.id },
        data: {
          status: 'paid',
          paidAt: options.paymentDate,
          paymentMethod: options.paymentMethod,
          linkedSaleId: sale.id,
        },
        include: {
          lines: { orderBy: { sortOrder: 'asc' } },
        },
      });

      return updated;
    }, TX_OPTIONS);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
      const reread = await prisma.invoice.findFirst({
        where: { id, businessId },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });
      if (reread && reread.status === 'paid') {
        return reread;
      }
    }
    throw err;
  }
}

export async function setInvoiceShareToken(
  businessId: string,
  id: string,
  shareToken: string,
  shareTokenExpiresAt: Date
): Promise<Invoice> {
  const existing = await prisma.invoice.findFirst({
    where: { id, businessId },
  });
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  return prisma.invoice.update({
    where: { id: existing.id },
    data: {
      shareToken,
      shareTokenExpiresAt,
    },
  });
}

export async function findInvoiceByShareToken(
  shareToken: string
): Promise<(Invoice & { lines: Prisma.InvoiceLineGetPayload<object>[]; business: Business }) | null> {
  return prisma.invoice.findUnique({
    where: { shareToken },
    include: {
      lines: {
        orderBy: { sortOrder: 'asc' },
      },
      business: true,
    },
  });
}

// -----------------------------------------------------------------------------
// 6. EXTERNAL TOMBSTONE (DELETIONS) SCOPED OPERATIONS
// -----------------------------------------------------------------------------

export async function listTombstones(
  businessId: string,
  options?: { since?: Date; limit?: number; cursor?: CursorPayload | null }
): Promise<ExternalTombstone[]> {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
  const since = options?.since;
  const cursor = options?.cursor;

  const cursorClause = cursor
    ? {
        OR: [
          { createdAt: { gt: cursor.updatedAt } },
          { createdAt: cursor.updatedAt, id: { gt: cursor.id } },
        ],
      }
    : null;

  return prisma.externalTombstone.findMany({
    where: {
      businessId,
      ...(since ? { createdAt: { gte: since } } : {}),
      ...(cursorClause ? cursorClause : {}),
    },
    take: limit + 1,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

export async function createTombstone(
  businessId: string,
  entityType: 'sale' | 'expense' | 'invoice' | 'customer',
  entityId: string
): Promise<ExternalTombstone> {
  return prisma.externalTombstone.create({
    data: {
      businessId,
      entityType,
      entityId,
    },
  });
}

// -----------------------------------------------------------------------------
// 7. AUDIT LOG SCOPED OPERATIONS
// -----------------------------------------------------------------------------

export interface CreateAuditLogInput {
  action: string;
  actor: string;
  platformId?: string | null;
  externalDeviceId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  oldData?: Prisma.InputJsonValue;
  newData?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function createAuditLog(
  businessId: string,
  data: CreateAuditLogInput
): Promise<AuditLog> {
  return prisma.auditLog.create({
    data: {
      businessId,
      action: data.action,
      actor: data.actor,
      platformId: data.platformId ?? null,
      externalDeviceId: data.externalDeviceId ?? null,
      resourceType: data.resourceType ?? null,
      resourceId: data.resourceId ?? null,
      oldData: data.oldData ?? undefined,
      newData: data.newData ?? undefined,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
    },
  });
}

/**
 * Resolves a business under a platform by either externalCustomerId (primary)
 * or by internal UUID (fallback).
 */
export async function findBusinessForPlatform(
  platformId: string,
  identifier: string
): Promise<Business | null> {
  // 1. Try externalCustomerId first
  const byExternal = await prisma.business.findFirst({
    where: { platformId, externalCustomerId: identifier },
  });
  if (byExternal) {
    return byExternal;
  }

  // 2. Fallback to UUID if identifier matches UUID shape
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) {
    return prisma.business.findFirst({
      where: { id: identifier, platformId },
    });
  }

  return null;
}

/**
 * Aggregates sales and expenses to produce a net profit summary for an account.
 */
export async function calculateProfitSummary(
  businessId: string,
  from?: Date,
  to?: Date
): Promise<{
  totalSales: Decimal;
  salesCount: number;
  totalExpenses: Decimal;
  expensesCount: number;
  netProfit: Decimal;
}> {
  const salesWhere: Prisma.SalesTransactionWhereInput = {
    businessId,
    status: { in: ['confirmed', 'completed'] },
  };
  if (from || to) {
    salesWhere.transactionDate = {};
    if (from) salesWhere.transactionDate.gte = from;
    if (to) salesWhere.transactionDate.lte = to;
  }

  const expenseWhere: Prisma.ExpenseWhereInput = {
    businessId,
  };
  if (from || to) {
    expenseWhere.expenseDate = {};
    if (from) expenseWhere.expenseDate.gte = from;
    if (to) expenseWhere.expenseDate.lte = to;
  }

  const [salesAgg, expensesAgg] = await Promise.all([
    prisma.salesTransaction.aggregate({
      where: salesWhere,
      _sum: { amount: true },
      _count: { id: true },
    }),
    prisma.expense.aggregate({
      where: expenseWhere,
      _sum: { amount: true },
      _count: { id: true },
    }),
  ]);

  const totalSales = salesAgg._sum.amount ?? new Decimal(0);
  const totalExpenses = expensesAgg._sum.amount ?? new Decimal(0);
  const netProfit = totalSales.minus(totalExpenses);

  return {
    totalSales,
    salesCount: salesAgg._count.id,
    totalExpenses,
    expensesCount: expensesAgg._count.id,
    netProfit,
  };
}

export interface OnboardAccountRecordInput {
  platformId: string;
  ownerUserId: string;
  externalCustomerId: string;
  businessName: string;
  ownerName: string;
  businessType?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

export async function onboardAccountRecord(
  data: OnboardAccountRecordInput
): Promise<{ account: Business; isNew: boolean }> {
  const existing = await prisma.business.findUnique({
    where: {
      platformId_externalCustomerId: {
        platformId: data.platformId,
        externalCustomerId: data.externalCustomerId,
      },
    },
  });

  if (existing) {
    return { account: existing, isNew: false };
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const insideExisting = await tx.business.findUnique({
          where: {
            platformId_externalCustomerId: {
              platformId: data.platformId,
              externalCustomerId: data.externalCustomerId,
            },
          },
        });
        if (insideExisting) {
          return { account: insideExisting, isNew: false };
        }

        const merchantId = await nextMerchantId(tx);

        const business = await tx.business.create({
          data: {
            platformId: data.platformId,
            externalCustomerId: data.externalCustomerId,
            userId: data.ownerUserId,
            businessName: data.businessName,
            ownerName: data.ownerName,
            businessType: data.businessType || null,
            merchantId,
            contactPhone: data.contactPhone || null,
            contactEmail: data.contactEmail || null,
            address: data.address || null,
            city: data.city || null,
            state: data.state || null,
            isActive: true,
          },
        });

        await tx.businessMember.create({
          data: {
            businessId: business.id,
            userId: data.ownerUserId,
            role: 'owner',
            isActive: true,
          },
        });

        await tx.auditLog.create({
          data: {
            platformId: data.platformId,
            businessId: business.id,
            userId: data.ownerUserId,
            actor: 'partner',
            action: 'account.onboarded',
            resourceType: 'business',
            resourceId: business.id,
            newData: {
              merchantId: business.merchantId,
              externalCustomerId: business.externalCustomerId,
              businessName: business.businessName,
            },
          },
        });

        return { account: business, isNew: true };
      },
      TX_OPTIONS
    );

    return result;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const raceExisting = await prisma.business.findUnique({
        where: {
          platformId_externalCustomerId: {
            platformId: data.platformId,
            externalCustomerId: data.externalCustomerId,
          },
        },
      });
      if (raceExisting) {
        return { account: raceExisting, isNew: false };
      }
    }
    throw err;
  }
}
