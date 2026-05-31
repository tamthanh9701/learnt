import { defineConfig } from 'vitest/config';

// QA characterization-test harness (S2-delta, M2 brownfield).
// happy-dom gives us localStorage for mock-path tests without a browser.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
