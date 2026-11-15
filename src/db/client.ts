import { PrismaClient, Prisma } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env['NODE_ENV'] === 'test' ? [] : ['warn', 'error'],
});

export type PrismaTransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export type DbClient = PrismaClient | PrismaTransactionClient;

export { Prisma };
export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;
