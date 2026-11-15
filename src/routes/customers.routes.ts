import { Router, type Request, type Response } from 'express';
import { formatPagedResponse, parsePaginationParams } from '../lib/cursor.js';
import { AppError } from '../lib/errors.js';
import {
  createOrReactivateCustomer,
  fetchCustomers,
  getCustomer,
  getCustomerByExternalId,
  patchCustomer,
} from '../services/customer.service.js';
import { deleteCustomer } from '../db/scoped.js';
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
} from '../validators/customer.validator.js';

export const customersRouter = Router({ mergeParams: true });

// GET /accounts/:accountId/customers
customersRouter.get('/', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const { limit, cursor, updatedSince } = parsePaginationParams(req.query);
  const customers = await fetchCustomers(businessId, { updatedSince: updatedSince ?? undefined, cursor, limit });
  const paged = formatPagedResponse(customers, limit);

  res.status(200).json(paged);
});

// POST /accounts/:accountId/customers
customersRouter.post('/', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const input = CreateCustomerSchema.parse(req.body);
  const customer = await createOrReactivateCustomer(businessId, input);

  res.status(201).json({ data: customer });
});

// GET /accounts/:accountId/customers/by-external-id/:externalId
customersRouter.get('/by-external-id/:externalId', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const externalId = req.params['externalId'];
  if (!externalId || typeof externalId !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }

  const customer = await getCustomerByExternalId(businessId, externalId);
  res.status(200).json({ data: customer });
});

// GET /accounts/:accountId/customers/:id
customersRouter.get('/:id', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const id = req.params['id'];
  if (!id || typeof id !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }

  const customer = await getCustomer(businessId, id);
  res.status(200).json({ data: customer });
});

// PATCH /accounts/:accountId/customers/:id
customersRouter.patch('/:id', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const id = req.params['id'];
  if (!id || typeof id !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }

  const input = UpdateCustomerSchema.parse(req.body);
  const updated = await patchCustomer(businessId, id, input);
  res.status(200).json({ data: updated });
});

// DELETE /accounts/:accountId/customers/:id
customersRouter.delete('/:id', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const id = req.params['id'];
  if (!id || typeof id !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }

  await deleteCustomer(businessId, id);
  res.status(200).json({ data: { deleted: true } });
});
