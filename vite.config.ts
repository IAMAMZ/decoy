import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The backend (FastAPI, port 8000) owns /ws/* and /debug/*; proxy them so pages use same-origin URLs.
export default defineConfig(({ mode }) => {
  // Read here, not in src/, so the Boson key stays out of the page (only referenced VITE_ vars are bundled).
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
        '/debug': 'http://127.0.0.1:8000',
        // Browser backend (backend/server.py): the /browser/ws stream and the /browser/tools checks
        '/browser': { target: 'http://127.0.0.1:8001', ws: true },
        // Boson with the key added; deployed, backend/routes/boson.py does the same
        '/api/boson': {
          target: 'https://api.boson.ai/v1',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/boson/, ''),
          headers: { Authorization: `Bearer ${env.BOSON_API_KEY || env.VITE_BOSON_API_KEY}` },
        },
      },
    },
  };
});
