// Excalidraw fetches its fonts from a CDN, which `font-src 'self'` in the
// Caddyfile blocks; point it at our origin, where `vite.config.ts` copies the
// package's font directory. Must be a module imported *before* Excalidraw —
// the same assignment inside SketchCanvas.tsx would run too late. '/' rather
// than '/fonts/': Excalidraw's paths are './fonts/Family/…' against this base.
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

window.EXCALIDRAW_ASSET_PATH = '/';

// The base is not enough: Excalidraw appends its CDN behind the local URL in
// every font's src list, and the browser checks CSP against every source in a
// list at FontFace construction, not when one is chosen. The fallback is never
// fetched, but it logs ~400 blocked-font entries per drawing. The list is
// assembled inside the editor bundle, so construction is the only place to
// strip it. `getContent` (SVG export) uses `fetch` and answers to
// `connect-src`, so it is unaffected.
const CDN_FALLBACK = '//esm.sh/';

const withoutCdnFallback = (src: string): string => {
  if (!src.includes(CDN_FALLBACK)) return src;
  const kept = src
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => !entry.includes(CDN_FALLBACK));
  // A FontFace with an empty src throws.
  return kept.length > 0 ? kept.join(', ') : src;
};

const NativeFontFace = window.FontFace;

class OriginFontFace extends NativeFontFace {
  constructor(...args: ConstructorParameters<typeof NativeFontFace>) {
    const [family, source, descriptors] = args;
    super(
      family,
      typeof source === 'string' ? withoutCdnFallback(source) : source,
      descriptors,
    );
  }
}

window.FontFace = OriginFontFace;

export {};
