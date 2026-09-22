import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { cpSync, createReadStream, existsSync } from 'fs';
import path from 'path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/*
 * Serve Excalidraw's fonts from this origin.
 *
 * `src/sketch/excalidrawAssets.ts` points Excalidraw at `/`, so it asks for
 * `/fonts/Excalifont/…` instead of a CDN — which is the only way to draw text
 * on a spot without widening `font-src` in the Caddyfile. This puts the files
 * where that path expects them.
 *
 * Not `public/`: the fonts are a build artefact of a dependency and would be
 * ~40 MB of vendored binaries in the repo. Copied out of `node_modules` at
 * build time, and streamed straight from there in dev.
 *
 * Xiaolai is skipped. It is the CJK fallback and it is most of the weight —
 * several hundred subsetted files — and the app ships in Norwegian Bokmål,
 * Nynorsk and English. Pasted CJK text falls back to a system font, which is
 * what would happen on a machine without the webfont anyway.
 */
function excalidrawFonts(): Plugin {
  const [devRoot, prodRoot] = ['dist/dev/fonts', 'dist/prod/fonts'].map((rel) =>
    path.resolve('node_modules/@excalidraw/excalidraw', rel),
  );
  // Dev first when serving, production first when building — the package ships
  // both, so a single order would put the dev font set in the deploy.
  const serveRoots = [devRoot, prodRoot];
  const buildRoots = [prodRoot, devRoot];
  const skipXiaolai = (src: string) => !src.includes(`${path.sep}Xiaolai`);
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
        // path.normalize collapses '..', so a leading one is the only way out
        // of the font directory and the only thing left to reject.
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
      cpSync(root, path.resolve(outDir, 'fonts'), {
        recursive: true,
        filter: skipXiaolai,
      });
    },
  };
}

// https://vite.dev/config/
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
  // urlUtils reads and rewrites window.location, so the suite needs a DOM.
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
});
