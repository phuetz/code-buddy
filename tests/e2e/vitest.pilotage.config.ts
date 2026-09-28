import { defineConfig } from 'vitest/config';

// Standalone runner for the real-browser demonstration. It avoids writing
// Vite's bundled configuration into a shared, read-only node_modules tree.
export default defineConfig({
  test: {
    testTimeout: 90_000,
    hookTimeout: 30_000,
  },
});
