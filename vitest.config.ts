import { defineConfig } from 'vitest/config';

// Unit tests live next to the code in src/. End-to-end tests (e2e/) run under Playwright.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
