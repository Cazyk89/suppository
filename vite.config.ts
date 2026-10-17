import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works from any static host path (GitHub Pages, a subfolder, etc.).
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  test: { environment: 'node' },
});
