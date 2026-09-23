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

// Pointing the base at this origin is not enough on its own. Excalidraw appends
// its own CDN to every font's src list as a last resort *behind* the URL that
// base produces, so each face is built as
//
//   url(/fonts/…) format('woff2'), url(https://esm.sh/…) format('woff2')
//
// and the browser checks CSP against every source in a list when the FontFace
// is constructed, not when one of them is chosen. All 234 files are served from
// here, so the fallback is never fetched — but it is still 400-odd blocked-font
// entries in the console, one per face plus one per face the loader goes on to
// want, drowning everything else on any page that opens a drawing.
//
// Stripping it at construction is the only place it can go: the list is
// assembled inside the editor bundle, and this module is what runs before it.
// Excalidraw's other reader of those URLs is `getContent`, which subsets a font
// for SVG export with `fetch` and so answers to `connect-src`; it keeps the
// whole list and still tries this origin first.
const CDN_FALLBACK = '//esm.sh/';

const withoutCdnFallback = (src: string): string => {
  if (!src.includes(CDN_FALLBACK)) return src;
  const kept = src
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => !entry.includes(CDN_FALLBACK));
  // A FontFace with an empty src throws. A font we cannot serve should fail to
  // load, which is visible and recoverable, rather than fail to exist.
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
