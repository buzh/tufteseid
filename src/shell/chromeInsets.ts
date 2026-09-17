import type Map from 'ol/Map';

/*
 * How much of the map the floating chrome is covering: the map's own size says
 * nothing about it, so anything that frames something has to work in the free
 * area. Surfaces opt in by carrying `data-chrome="<edge>"`. Measured on
 * demand, never observed.
 */

/** [top, right, bottom, left] — the order `View#fit` wants for padding. */
export type ChromeInsets = [number, number, number, number];

export const CHROME_MARGIN_PX = 24;

// Beyond this View#fit resolves a rectangle bigger than its space.
const MAX_PADDING_FRACTION = 0.7;

const EDGES = ['top', 'right', 'bottom', 'left'] as const;
type ChromeEdge = (typeof EDGES)[number];

const isEdge = (v: string | undefined): v is ChromeEdge =>
  v != null && (EDGES as readonly string[]).includes(v);

export const chromeInsets = (map: Map): ChromeInsets => {
  const insets: ChromeInsets = [0, 0, 0, 0];
  const view = map.getViewport()?.getBoundingClientRect();
  if (!view || view.width === 0 || view.height === 0) return insets;

  for (const el of document.querySelectorAll<HTMLElement>('[data-chrome]')) {
    const edge = el.dataset.chrome;
    if (!isEdge(edge)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    // Depth into the map from the edge it hugs; negative once scrolled clear.
    const depth =
      edge === 'top'
        ? r.bottom - view.top
        : edge === 'bottom'
          ? view.bottom - r.top
          : edge === 'left'
            ? r.right - view.left
            : view.right - r.left;

    const limit = edge === 'top' || edge === 'bottom' ? view.height : view.width;
    const i = EDGES.indexOf(edge);
    insets[i] = Math.max(insets[i], Math.min(depth, limit));
  }

  return insets;
};

// Opposing paddings that exceed the viewport scale down together.
const clampPair = (a: number, b: number, size: number): [number, number] => {
  const budget = size * MAX_PADDING_FRACTION;
  const total = a + b;
  if (total <= budget || total <= 0) return [a, b];
  const k = budget / total;
  return [a * k, b * k];
};

/**
 * Extra room for a funn on top of the chrome: metres across, so the free area
 * alone puts it edge to edge. Shared with `funn/FunnSurface.tsx`.
 */
export const FUNN_MARGIN_PX = 90;

/** `View#fit` padding that clears the chrome. */
export const fitPadding = (
  map: Map,
  margin = CHROME_MARGIN_PX,
): ChromeInsets => {
  const [top, right, bottom, left] = chromeInsets(map);
  const [width, height] = map.getSize() ?? [0, 0];
  const [t, b] = clampPair(top + margin, bottom + margin, height);
  const [r, l] = clampPair(right + margin, left + margin, width);
  return [t, r, b, l];
};
