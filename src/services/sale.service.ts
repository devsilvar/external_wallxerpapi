import {
  createSale,
  deleteSale,
  findSale,
  findSaleByReference,
  listSales,
  type CreateSaleInput,
  type ListOptions,
} from '../db/scoped.js';
import { AppError } from '../lib/errors.js';
import { formatMoney, parseMoney } from '../lib/money.js';
import { checkIdempotency, hashCanonicalPayload } from './idempotency.js';

export async function getSale(businessId: string, id: string) {
  const sale = await findSale(businessId, id);
  if (!sale) {
    throw new AppError(404, 'NOT_FOUND', 'Sale not found');
  }
  return sale;
}

export async function fetchSales(businessId: string, options?: ListOptions) {
  return listSales(businessId, options);
}

export async function createSaleWithValidation(
  businessId: string,
  input: CreateSaleInput
) {
  // Validate line items and amounts if items are provided
  if (input.items && input.items.length > 0) {
    let sum = parseMoney(0);
    const validatedItems = input.items.map((item, idx) => {
      const qty = parseMoney(item.quantity);
      const price = parseMoney(item.unitPrice);
      const computedTotal = parseMoney(qty.mul(price));
      const declaredTotal = parseMoney(item.lineTotal);

      if (computedTotal.toFixed(2) !== declaredTotal.toFixed(2)) {
        throw new AppError(
          400,
          'AMOUNT_MISMATCH',
          `Line item ${idx + 1} total ${declaredTotal.toFixed(2)} does not match quantity (${qty.toFixed(2)}) × unit price (${price.toFixed(2)}) = ${computedTotal.toFixed(2)}`
        );
      }

      sum = parseMoney(sum.add(declaredTotal));

      return {
        name: item.name,
        quantity: qty.toFixed(2),
        unitPrice: price.toFixed(2),
        lineTotal: declaredTotal.toFixed(2),
        sortOrder: item.sortOrder ?? idx,
      };
    });

    const declaredAmount = parseMoney(input.amount);
    if (sum.toFixed(2) !== declaredAmount.toFixed(2)) {
      throw new AppError(
        400,
        'AMOUNT_MISMATCH',
        `Sale amount ${declaredAmount.toFixed(2)} does not match sum of line items ${sum.toFixed(2)}`
      );
    }

    input.items = validatedItems;
  }

  // Idempotency check by referenceId
  const existing = await findSaleByReference(businessId, input.referenceId);
  const payloadHash = hashCanonicalPayload(input);

  if (existing) {
    // Compare stored hash in metadata or canonical representation
    const storedHash = (existing.metadata as Record<string, unknown> | null)?.[
      '_payloadHash'
    ] as string | undefined;

    const existingCanonicalHash =
      storedHash ||
      hashCanonicalPayload({
        referenceId: existing.referenceId,
        amount: formatMoney(existing.amount),
        source: existing.source,
        status: existing.status,
        transactionDate: existing.transactionDate.toISOString().slice(0, 10),
        description: existing.description,
        customerId: existing.customerId,
        customerName: existing.customerName,
        items: existing.items.map((i) => ({
          name: i.name,
          quantity: formatMoney(i.quantity),
          unitPrice: formatMoney(i.unitPrice),
          lineTotal: formatMoney(i.lineTotal),
          sortOrder: i.sortOrder,
        })),
      });

    const check = checkIdempotency(existing, payloadHash, existingCanonicalHash);
    return {
      sale: check.record!,
      isReplay: true,
    };
  }

  // Inject _payloadHash into metadata for fast, exact idempotency verification on replay
  const userMetadata = (input.metadata as Record<string, unknown> | undefined) || {};
  const metadataWithHash = {
    ...userMetadata,
    _payloadHash: payloadHash,
  };

  const created = await createSale(businessId, {
    ...input,
    amount: formatMoney(input.amount),
    metadata: metadataWithHash,
  });

  return {
    sale: created,
    isReplay: false,
  };
}

export async function removeSale(businessId: string, id: string) {
  return deleteSale(businessId, id);
}
