import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Builds the browser player to out/player/player.js (ONE self-contained IIFE: no code splitting, no external imports, no CDN) and
// out/player/player.css. The engine's build step copies both next to game-data.js and index.html (see docs/player.md).
export default defineConfig({
  root: __dirname,
  // no public folder: the bundle is all there is
  publicDir: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'out/player',
    emptyOutDir: true,
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: false,
    cssCodeSplit: false,
    reportCompressedSize: false,
    lib: {
      entry: resolve(__dirname, 'src/player/main.ts'),
      formats: ['iife'],
      name: 'EduPlayer',
      fileName: () => 'player.js',
      cssFileName: 'player'
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
      // zod's /*@__PURE__*/ comments sit where rollup cannot read them: harmless, and not worth a screenful of warnings per build
      onwarn(warning, warn) {
        if (warning.code === 'INVALID_ANNOTATION') return
        warn(warning)
      }
    }
  }
})
