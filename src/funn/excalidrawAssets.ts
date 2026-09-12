/*
 * Where Excalidraw fetches its fonts from.
 *
 * Left alone it pulls them off a CDN at runtime, which `font-src 'self'` in
 * the Caddyfile blocks — and widening the CSP to admit someone else's origin
 * for a decorative typeface is not a trade worth making. Setting the asset
 * path makes it ask *this* origin instead, and `vite.config.ts` copies the
 * font directory out of the package into the build so the request resolves.
 *
 * A module of its own, imported first by `FunnCanvas.tsx`, because ES modules
 * evaluate in source order: the same assignment written above the Excalidraw
 * import inside that file would still run after it.
 *
 * '/' rather than '/fonts/': Excalidraw's own paths are './fonts/Family/…',
 * resolved against this as a base.
 */
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

window.EXCALIDRAW_ASSET_PATH = '/';

export {};
