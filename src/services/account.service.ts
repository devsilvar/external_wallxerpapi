import { findBusiness, updateBusiness, onboardAccountRecord } from '../db/scoped.js';
import { AppError } from '../lib/errors.js';
import {
  OnboardAccountSchema,
  UpdateAccountSchema,
  UUID_REGEX,
  type OnboardAccountInput,
  type UpdateAccountInput,
} from '../validators/account.validator.js';

export async function getAccountProfile(businessId: string) {
  const account = await findBusiness(businessId);
  if (!account) {
    throw new AppError(404, 'NOT_FOUND', 'Account not found');
  }

  return {
    id: account.id,
    platformId: account.platformId,
    merchantId: account.merchantId,
    externalCustomerId: account.externalCustomerId,
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
    platformId: updated.platformId,
    merchantId: updated.merchantId,
    externalCustomerId: updated.externalCustomerId,
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

export async function onboardAccount(
  platformId: string,
  ownerUserId: string,
  body: unknown
) {
  const input: OnboardAccountInput = OnboardAccountSchema.parse(body);

  if (UUID_REGEX.test(input.customerId)) {
    throw new AppError(
      400,
      'CUSTOMER_ID_RESERVED',
      'customerId cannot be in UUID format (UUID format is reserved for internal account IDs)'
    );
  }

  const businessName = input.businessName ?? input.name!;
  const ownerName = input.ownerName ?? businessName;
  const contactPhone = input.contactPhone ?? input.phone;
  const contactEmail = input.contactEmail ?? input.email;

  const result = await onboardAccountRecord({
    platformId,
    ownerUserId,
    externalCustomerId: input.customerId,
    businessName,
    ownerName,
    businessType: input.businessType,
    address: input.address,
    city: input.city,
    state: input.state,
    contactPhone,
    contactEmail,
  });

  return {
    account: {
      id: result.account.id,
      platformId: result.account.platformId,
      merchantId: result.account.merchantId,
      externalCustomerId: result.account.externalCustomerId,
      businessName: result.account.businessName,
      ownerName: result.account.ownerName,
      businessType: result.account.businessType,
      address: result.account.address,
      city: result.account.city,
      state: result.account.state,
      contactPhone: result.account.contactPhone,
      contactEmail: result.account.contactEmail,
      isActive: result.account.isActive,
      createdAt: result.account.createdAt.toISOString(),
      updatedAt: result.account.updatedAt.toISOString(),
    },
    isNew: result.isNew,
  };
}
