import { findBusiness, updateBusiness } from '../db/scoped.js';
import { AppError } from '../lib/errors.js';
import { UpdateAccountSchema, type UpdateAccountInput } from '../validators/account.validator.js';

export async function getAccountProfile(businessId: string) {
  const account = await findBusiness(businessId);
  if (!account) {
    throw new AppError(404, 'NOT_FOUND', 'Account not found');
  }

  return {
    id: account.id,
    merchantId: account.merchantId,
    businessName: account.businessName,
    ownerName: account.ownerName,
    businessType: account.businessType,
    address: account.address,
    city: account.city,
    state: account.state,
    contactPhone: account.contactPhone,
    contactEmail: account.contactEmail,
    isActive: account.isActive,
    subscriptionExpiresAt: account.subscriptionExpiresAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export async function updateAccountProfile(businessId: string, body: unknown) {
  const validatedInput: UpdateAccountInput = UpdateAccountSchema.parse(body);

  const updated = await updateBusiness(businessId, validatedInput);

  return {
    id: updated.id,
    merchantId: updated.merchantId,
    businessName: updated.businessName,
    ownerName: updated.ownerName,
    businessType: updated.businessType,
    address: updated.address,
    city: updated.city,
    state: updated.state,
    contactPhone: updated.contactPhone,
    contactEmail: updated.contactEmail,
    isActive: updated.isActive,
    subscriptionExpiresAt: updated.subscriptionExpiresAt,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}
