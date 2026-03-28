import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      '/api/v1': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/api/ai': {
        target: 'http://localhost:8003',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ws/ai': {
        target: 'ws://localhost:8003',
        ws: true,
        rewrite: (path) => path.replace(/^\/ws\/ai/, '/ws'),
      },
      '/ws/exec': {
        target: 'ws://localhost:8004',
        ws: true,
        rewrite: (path) => path.replace(/^\/ws\/exec/, '/api/v1/exec/ws'),
      },
      '/ws/collab': {
        target: 'ws://localhost:8005',
        ws: true,
        rewrite: (path) => path.replace(/^\/ws\/collab/, '/api/v1/collab/ws'),
      },
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          'monaco-editor': ['monaco-editor'],
          'yjs-core': ['yjs', 'y-monaco', 'y-websocket'],
          'webcontainer': ['@webcontainer/api'],
          'terminal': ['xterm', 'xterm-addon-fit'],
          'vendor': ['react', 'react-dom', 'react-router-dom', 'zustand']
        }
      }
    }
  },
  preview: {
    port: 4173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  }
});
