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
    }
  }
}

export {};
