import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * The manifest is authored at the extension root (where you expect to find it)
 * and copied verbatim into dist/, which is what Chrome loads.
 */
function copyManifest(): Plugin {
  return {
    name: 'brotomap:copy-manifest',
    closeBundle() {
      copyFileSync(`${here}manifest.json`, `${here}dist/manifest.json`);
    },
  };
}

/**
 * Build 1 of 2: extension pages + the background service worker.
 *
 * The content script is built separately (vite.content.config.ts) because it
 * must be a classic script - Chrome will not load an ES module into a page -
 * while the service worker is an ES module. One config cannot emit both.
 */
export default defineConfig({
  root: here,
  plugins: [react(), copyManifest()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Extensions are loaded from disk by Chrome; readable output is worth more
    // than the last few kilobytes, and source maps are inline-friendly here.
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: `${here}popup.html`,
        roadmap: `${here}roadmap.html`,
        background: `${here}src/background/index.ts`,
      },
      output: {
        // background.js must keep an exact, stable name: the manifest points at
        // it. Everything else may be hashed - both page entries are called
        // "main", so hashing is what keeps them from colliding.
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
