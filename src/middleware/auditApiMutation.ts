import type { RequestHandler } from 'express';
import { createAuditLog } from '../db/scoped.js';
import { logger } from '../lib/logger.js';

const RESOURCES: Record<string, { type: string; verb: string }> = {
 '': { type: 'business', verb: 'ACCOUNT' },
 sales: { type: 'sale', verb: 'SALE' },
 expenses: { type: 'expense', verb: 'EXPENSE' },
 invoices: { type: 'invoice', verb: 'INVOICE' },
 customers: { type: 'customer', verb: 'CUSTOMER' },
};

function actionFor(method: string, verb: string): string {
 if (method === 'POST') return `${verb}_CREATED`;
 if (method === 'DELETE') return `${verb}_DELETED`;
 return `${verb}_UPDATED`;
}

/**
 * Writes an audit entry for every successful partner data mutation, so the
 * operator admin surface can answer "what did this merchant do?" — not just
 * what an operator changed.
 *
 * Runs after `resolveAccountByPartner` (needs `req.account`) and logs on
 * `finish`, so failed requests (4xx/5xx) leave no audit row. Fire-and-forget:
 * auditing must not slow down or break the API call it describes.
 */
export const auditApiMutation: RequestHandler = (req, res, next) => {
 if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
 next();
 return;
 }

 const platform = req.platform;
 const businessId = req.account?.id;
 if (!platform || !businessId) {
 next();
 return;
 }

 const segments = req.path.split('/').filter(Boolean);
 const segment = segments[0] ?? '';
 const resource = RESOURCES[segment];
 if (!resource) {
 next();
 return;
 }

 const action = actionFor(req.method, resource.verb);
 // Per-resource mutations carry the id in the path; collection POSTs only learn
// it from the handler, so capture it from the response body on its way out.
let createdId: string | null = null;
const originalJson = res.json.bind(res);
res.json = (body: unknown) => {
const data = (body as { data?: { id?: unknown } } | null)?.data;
if (data && typeof data.id === 'string') createdId = data.id;
return originalJson(body);
};
 // The resource id is resolved inside the finish handler: for collection POSTs
// it only exists once the handler has written the body.
 const actor = `platform:${platform.name}`;
 const userAgent =
 typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

 res.on('finish', () => {
 if (res.statusCode >= 400) return;

 void createAuditLog(businessId, {
 action,
 actor,
 platformId: platform.id,
 resourceType: resource.type,
 resourceId: segments[1] ?? createdId,
 ipAddress: req.ip ?? null,
 userAgent,
 }).catch((err) => {
 logger.warn({ err, action, businessId }, 'failed to write API mutation audit log');
 });
 });

 next();
};
