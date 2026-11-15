/**
 * Type augmentations for Express Request.
 */
declare global {
  namespace Express {
    interface Request {
      /** Server-minted request ID (UUID) */
      id: string;

      /** Authenticated external device */
      device?: {
        id: string;
        businessId: string;
        platformId: string;
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
