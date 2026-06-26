import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
