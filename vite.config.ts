import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend (FastAPI, port 8000) owns /ws/* and /debug/*; proxy them so pages use same-origin URLs.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
      '/debug': 'http://127.0.0.1:8000',
      // Browser backend (backend/server.py): the /browser/ws stream and the /browser/tools checks
      '/browser': { target: 'http://127.0.0.1:8001', ws: true },
    },
  },
});
