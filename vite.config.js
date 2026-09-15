import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  server: {
    // Local dev: run `vercel dev` on :3000 and this proxies /api/ai-safar there.
    proxy: {
      '/api': 'http://localhost:3000'
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2019',
    cssMinify: true
  }
});