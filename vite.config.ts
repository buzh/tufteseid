import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { cpSync, createReadStream, existsSync } from 'fs';
import path from 'path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Serves Excalidraw's fonts from this origin. Every subset, Xiaolai included:
// Excalidraw lists esm.sh after our URL in each FontFace, so a subset we do not
// serve becomes a cross-origin request that `font-src 'self'` blocks.
function excalidrawFonts(): Plugin {
  const [devRoot, prodRoot] = ['dist/dev/fonts', 'dist/prod/fonts'].map((rel) =>
    path.resolve('node_modules/@excalidraw/excalidraw', rel),
  );
  // The package ships both sets; production must come first when building.
  const serveRoots = [devRoot, prodRoot];
  const buildRoots = [prodRoot, devRoot];
  let outDir = 'dist';

  return {
    name: 'excalidraw-fonts',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (!url?.startsWith('/fonts/')) return next();
        const rel = path.normalize(
          decodeURIComponent(url.slice('/fonts/'.length)),
        );
        // path.normalize collapses inner '..', so a leading one is the only
        // remaining escape from the font directory.
        if (rel.startsWith('..')) return next();
        const root = serveRoots.find((dir) => existsSync(path.join(dir, rel)));
        if (!root) return next();
        res.setHeader('Content-Type', 'font/woff2');
        createReadStream(path.join(root, rel)).pipe(res);
      });
    },
    closeBundle() {
      const root = buildRoots.find((dir) => existsSync(dir));
      if (!root) {
        this.warn('Excalidraw fonts not found; text on a drawing will 404');
        return;
      }
      cpSync(root, path.resolve(outDir, 'fonts'), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    excalidrawFonts(),
  ],
  build: {
    sourcemap: true,
  },
  server: {
    port: 3000,
  },
  preview: {
    port: 4173,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
});
