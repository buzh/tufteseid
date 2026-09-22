// Excalidraw fetches its fonts from a CDN by default, which `font-src 'self'`
// in the Caddyfile blocks; this points it at our origin, where `vite.config.ts`
// copies the package's font directory. Must be a module imported before
// Excalidraw itself — ES modules evaluate in source order, so the same
// assignment inside SketchCanvas.tsx would run too late. '/' rather than
// '/fonts/': Excalidraw's paths are './fonts/Family/…' against this base.
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

window.EXCALIDRAW_ASSET_PATH = '/';

export {};
