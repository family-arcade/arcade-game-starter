import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { firstPaint } from './src/i18n/firstPaint.ts';

// The page's words are read from disk on every page transform, so editing src/i18n/messages/en.json
// never restarts the dev server (a restart would drop a Play together room). Node's fs is loaded this way
// because the project carries no Node type definitions.
const nodeFs = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ nodeFs)) as { readFileSync(path: URL, encoding: 'utf8'): string };
const catalog = new URL('./src/i18n/messages/en.json', import.meta.url);

// base './' makes the build work from any GitHub Pages path
// (https://<user>.github.io/<repo>/), so you never have to edit it.
export default defineConfig(async ({ mode }) => {
  // `npm run tools` (mode "tools"): the dev tools server, port from DEV_TOOLS_PORT (default 4320).
  // The file is loaded by a variable name so tsc, which has no types for it, leaves it alone.
  const toolsFile = new URL('./tools/dev-tools.mjs', import.meta.url).href;
  const tools = mode === 'tools' ? ((await import(/* @vite-ignore */ toolsFile)) as { devTools(): Plugin }).devTools() : null;
  const port = Number(loadEnv(mode, '.', '').DEV_TOOLS_PORT) || 4320;
  return {
  base: './',
  // safari15: an iPad on iPadOS 15 still runs the game.
  build: { target: 'safari15' },
  server: tools ? { host: '127.0.0.1', port, strictPort: true, allowedHosts: ['.ts.net'] } : {},
  plugins: [...(tools ? [tools] : []), { name: 'first-paint', transformIndexHtml: (html: string) => firstPaint(html, JSON.parse(readFileSync(catalog, 'utf8').replace(/^\uFEFF/, ''))) }],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    setupFiles: ['src/testSetup.ts'],
  },
};
});
