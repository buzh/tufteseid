import type Map from 'ol/Map';

/*
 * How much of the map the floating chrome is covering, right now.
 *
 * The shell puts every surface *over* the map rather than beside it, so the
 * map's own size says nothing about how much of it you can actually see. Any
 * code that frames something — fitting a lokalitet's rectangle, seeding a new
 * one from the viewport, zooming to a funn — has to work in the free area, or
 * it centres its subject underneath the ribbon or behind the dock.
 *
 * This replaced a lone `ribbonHeight()` that measured `[data-ribbon]` and knew
 * about no other edge. Surfaces opt in by carrying `data-chrome="<edge>"`,
 * which is deliberately generic: a new panel becomes part of the calculation
 * by declaring which edge it hugs, with nothing to register anywhere.
 *
 * Measured on demand, never observed. Nothing here reacts to the chrome
 * changing size — the values are read at the moment a fit is computed, so
 * there is no ResizeObserver, no layout state, and no re-render (and, since
 * the OL canvas never resizes, no new GetMap requests either).
 */

/** [top, right, bottom, left] — the order `View#fit` wants for padding. */
export type ChromeInsets = [number, number, number, number];

// Breathing room between the chrome and whatever is being framed, so the
// subject reads as being inside the free area rather than tucked under a bar.
export const CHROME_MARGIN_PX = 24;

// Padding beyond this leaves View#fit resolving a rectangle bigger than the
// space it has, which it answers by zooming out to nothing useful.
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
    // A collapsed or display:none surface covers nothing.
    if (r.width === 0 || r.height === 0) continue;

    // How far into the map the surface reaches from the edge it hugs. A
    // surface that has scrolled clear of the map gives a negative depth,
    // which the max against 0 discards.
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

// Two opposing paddings that together exceed the viewport cannot both be
// honoured; scale them down together rather than letting one win.
const clampPair = (a: number, b: number, size: number): [number, number] => {
  const budget = size * MAX_PADDING_FRACTION;
  const total = a + b;
  if (total <= budget || total <= 0) return [a, b];
  const k = budget / total;
  return [a * k, b * k];
};

/**
 * `View#fit` padding that clears the chrome. Use this instead of a hard-coded
 * `[80, 80, 80, 80]`: the numbers those guessed at are exactly what the
 * floating shell made unknowable.
 */
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
