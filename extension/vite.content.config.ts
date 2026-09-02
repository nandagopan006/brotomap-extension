import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * Build 2 of 2: the content script.
 *
 * Emitted as a single self-contained IIFE with no imports, because Chrome loads
 * content scripts as classic scripts. It also runs inside the student's portal
 * page, so it stays as small as we can keep it - no React, no zod, no shared
 * runtime; only types cross this boundary.
 *
 * emptyOutDir is false so this build adds to dist/ instead of wiping build 1.
 */
export default defineConfig({
  root: here,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: `${here}src/content/index.ts`,
      output: {
        format: 'iife',
        entryFileNames: 'content.js',
      },
    },
  },
});
