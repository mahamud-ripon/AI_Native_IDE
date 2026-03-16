import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin'
    }
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
  }
});
