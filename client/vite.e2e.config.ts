import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { mockApi } from './e2e/mockApi';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Runs the real UI against fake auth and a scripted API, with no credentials needed. It is used
 * by the Playwright smoke test and for previews. This file and e2e/ never enter a production
 * build, because only vite.config.ts is used there.
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), mockApi()],
  envDir: path.resolve(here, 'e2e'),
  resolve: {
    alias: [
      { find: '@/lib/firebase', replacement: path.resolve(here, 'e2e/fakeFirebase.ts') },
      { find: '@/lib/razorpayCheckout', replacement: path.resolve(here, 'e2e/fakeCheckout.ts') },
      { find: '@', replacement: path.resolve(here, 'src') },
    ],
  },
  server: { port: 5199, strictPort: true },
});
