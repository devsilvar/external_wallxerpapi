import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Every integration file opens its own Prisma pool against the shared test
    // database. Uncapped file parallelism exhausts the pooler's connection
    // budget and surfaces as "Server has closed the connection" mid-transaction.
    maxWorkers: 4,
    minWorkers: 1,
    env: {
      NODE_ENV: 'test',
      // Keeps each test file's Prisma pool small enough that the shared test
      // database does not run out of connections under parallel file execution.
      DATABASE_CONNECTION_LIMIT: '3',
    },
  },
});
