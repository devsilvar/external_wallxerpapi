export interface HasSubscriptionExpiry {
  subscriptionExpiresAt: Date | null;
}

/**
 * Checks whether an entity's subscription is expired.
 * NULL means no expiry (correct for pilot accounts).
 */
export function isSubscriptionExpired(
  entity: HasSubscriptionExpiry | null | undefined,
  now = Date.now()
): boolean {
  if (!entity || !entity.subscriptionExpiresAt) {
    return false;
  }
  return entity.subscriptionExpiresAt.getTime() <= now;
}

export function isPlatformExpired(
  platform: HasSubscriptionExpiry | null | undefined,
  now = Date.now()
): boolean {
  return isSubscriptionExpired(platform, now);
}

export function isAccountExpired(
  business: HasSubscriptionExpiry | null | undefined,
  now = Date.now()
): boolean {
  return isSubscriptionExpired(business, now);
}

export function buildExpiryDetails(expiresAt: Date): { expiresAt: string } {
  return {
    expiresAt: expiresAt.toISOString(),
  };
}
