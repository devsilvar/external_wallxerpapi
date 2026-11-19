/**
 * Type augmentations for Express Request.
 */
declare global {
  namespace Express {
    interface Request {
      /** Server-minted request ID (UUID) */
      id: string;

      /** Authenticated partner platform */
      platform?: {
        id: string;
        name: string;
        ownerUserId: string;
        isActive: boolean;
      };

      /** Resolved and verified account scope */
      account?: {
        id: string;
      };

      /** Authenticated admin operator */
      admin?: {
        id: string;
        name: string;
        role: string;
      };

      /** Authenticated developer portal session */
      developer?: {
        userId: string;
        platformId: string | null;
        sessionId: string;
        user: {
          id: string;
          email: string | null;
          fullName: string | null;
          isVerified: boolean;
        };
        platform?: {
          id: string;
          name: string;
          approvalStatus: string;
          isActive: boolean;
          suspendedAt: Date | null;
          suspendedReason: string | null;
        } | null;
      };
    }
  }
}

export {};
