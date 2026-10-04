import { defineConfig } from 'vitest/config';

// base './' makes the build work from any GitHub Pages path
// (https://<user>.github.io/<repo>/), so you never have to edit it.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
