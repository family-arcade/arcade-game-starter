import { defineConfig } from 'vitest/config';
import { dialectoInContextVite } from './tooling/dialecto-in-context.mjs';

// base './' makes the build work from any GitHub Pages path
// (https://<user>.github.io/<repo>/), so you never have to edit it.
export default defineConfig(({ mode }) => ({
  base: './',
  build: { target: 'es2022' },
  // The Dialecto add-on, copied unchanged from the Dialecto SDK. Dev only: it is not in any other
  // mode or in a build. It reads the project id from DIALECTO_PROJECT (put it in .env.local).
  plugins: mode === 'dialecto' ? [dialectoInContextVite()] : [],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
}));
