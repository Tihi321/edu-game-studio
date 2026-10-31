import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Builds the live quiz client (src/live-client) to out/live/live.js (ONE IIFE: no code splitting, no external imports, no CDN) and
// out/live/live.css. The engine serves both from `/live/` (see docs/live-quiz.md).
export default defineConfig({
  root: __dirname,
  publicDir: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'out/live',
    emptyOutDir: true,
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: false,
    cssCodeSplit: false,
    reportCompressedSize: false,
    lib: {
      entry: resolve(__dirname, 'src/live-client/main.ts'),
      formats: ['iife'],
      name: 'EduLive',
      fileName: () => 'live.js',
      cssFileName: 'live'
    },
    rollupOptions: { output: { inlineDynamicImports: true } }
  }
})
