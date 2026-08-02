import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist/renderer',
    emptyDirOnly: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    open: true,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:51236',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:51236',
        ws: true,
      },
    },
  },
});
