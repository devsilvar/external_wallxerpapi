import {
  createCustomer,
  findCustomer,
  findCustomerByExternalId,
  listCustomers,
  reactivateCustomer,
  updateCustomer,
  type CreateCustomerInput,
  type ListOptions,
  type UpdateCustomerInput,
} from '../db/scoped.js';
import { AppError } from '../lib/errors.js';
import { checkIdempotency, hashCanonicalPayload } from './idempotency.js';

export async function getCustomer(businessId: string, id: string) {
  const customer = await findCustomer(businessId, id);
  if (!customer) {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }
  return customer;
}

export async function getCustomerByExternalId(businessId: string, externalId: string) {
  const customer = await findCustomerByExternalId(businessId, externalId);
  if (!customer) {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }
  return customer;
}

export async function fetchCustomers(businessId: string, options?: ListOptions) {
  return listCustomers(businessId, options);
}

export async function createOrReactivateCustomer(
  businessId: string,
  input: CreateCustomerInput
) {
  const existing = await findCustomerByExternalId(businessId, input.externalId);

  if (existing) {
    // If soft-deleted, reactivate customer (plan §P4-04)
    if (!existing.isActive) {
      return reactivateCustomer(businessId, existing.id, input);
    }

    // Active customer: verify idempotency
    const incomingHash = hashCanonicalPayload(input);
    const existingHash = hashCanonicalPayload({
      externalId: existing.externalId,
      name: existing.name,
      email: existing.email,
      phone: existing.phone,
      address: existing.address,
      city: existing.city,
      state: existing.state,
      taxId: existing.taxId,
      notes: existing.notes,
    });

    const check = checkIdempotency(existing, incomingHash, existingHash);
    return check.record!;
  }

  return createCustomer(businessId, input);
}

export async function patchCustomer(
  businessId: string,
  id: string,
  input: UpdateCustomerInput
) {
  return updateCustomer(businessId, id, input);
}
