declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

window.EXCALIDRAW_ASSET_PATH = '/';

const CDN_FALLBACK = '//esm.sh/';

const withoutCdnFallback = (src: string): string => {
  if (!src.includes(CDN_FALLBACK)) return src;
  const kept = src
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => !entry.includes(CDN_FALLBACK));
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
