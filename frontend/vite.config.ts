import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend (FastAPI, port 8000) owns /ws/* and /debug/*; proxy them so pages use same-origin URLs.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8000', ws: true },
      '/debug': 'http://localhost:8000',
    },
  },
});
