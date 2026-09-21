import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  build: {
    sourcemap: true,
  },
  server: {
    port: 3000,
  },
  preview: {
    port: 4173,
  },
  // urlUtils reads and rewrites window.location, so the suite needs a DOM.
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
});
