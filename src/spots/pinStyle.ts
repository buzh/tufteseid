import {
  Circle as CircleStyle,
  Fill,
  Icon,
  Stroke,
  Style,
  Text,
} from 'ol/style';

// Over the terrain analysis (4), under the Kulturminner theme layers (10).
// Full inventory in docs/map-layers.md.
export const PIN_Z_INDEX = 6;

const ACCENT = '#ff6a00';

// SVG user units; the anchor, the label offset and the grab box derive from
// these.
const W = 22;
const H = 27;
/** The point the pin is stuck through, and the icon anchor. */
const TIP_X = 5.2;
const TIP_Y = 25.2;
/** The head, up and to the right of the tip. */
const HEAD_X = 14.8;
const HEAD_Y = 6.6;
const HEAD_R = 5;

const SHAFT = `M13.29 5.82 L16.31 7.38 L${TIP_X} ${TIP_Y} Z`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2}" viewBox="0 0 ${W} ${H}">\
<g stroke-linejoin="round" stroke-linecap="round">\
<path d="${SHAFT}" fill="#fff" stroke="#fff" stroke-width="2.6" opacity=".92"/>\
<circle cx="${HEAD_X}" cy="${HEAD_Y}" r="${HEAD_R}" fill="#fff" stroke="#fff" stroke-width="2.6" opacity=".92"/>\
<path d="${SHAFT}" fill="#cfd4da" stroke="rgba(0,0,0,.45)" stroke-width=".7"/>\
<circle cx="${HEAD_X}" cy="${HEAD_Y}" r="${HEAD_R}" fill="${ACCENT}" stroke="rgba(0,0,0,.35)" stroke-width=".7"/>\
<circle cx="${HEAD_X - 1.8}" cy="${HEAD_Y - 1.8}" r="1.4" fill="#fff" opacity=".45"/>\
</g></svg>`;

const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// The SVG rasterizes at twice the worn size for retina, so every scale below
// is halved on its way into `Icon`.
const HIDPI = 2;

/** Multiples of the SVG units above: `saved` is 19 css px wide, 23 tall. */
const SIZE = { saved: 0.85, active: 1, hand: 1.08 };

// Hoisted: an `Icon` carries its decoded image and the style function runs per
// pin per redraw.
const pinIcon = (scale: number, opacity = 1) =>
  new Icon({
    src,
    anchor: [TIP_X / W, TIP_Y / H],
    scale: scale / HIDPI,
    opacity,
  });

const savedPin = pinIcon(SIZE.saved);
const activePin = pinIcon(SIZE.active);
const handPin = pinIcon(SIZE.hand);
const cursorPin = pinIcon(SIZE.hand, 0.85);

/** Drawn at the anchor, so it marks the pixel the tip is pointing at. */
const ring = (radius: number) =>
  new Style({
    image: new CircleStyle({
      radius,
      fill: new Fill({ color: 'rgba(255, 106, 0, 0.16)' }),
      stroke: new Stroke({ color: 'rgba(255, 106, 0, 0.55)', width: 1 }),
    }),
  });

/** Where the head sits relative to the tip, in css pixels at a given size. */
const headOffset = (scale: number): [number, number] => [
  (HEAD_X - TIP_X) * scale,
  (HEAD_Y - TIP_Y) * scale,
];

/** Between the top of the head and the underside of the label. */
const LABEL_GAP = 7;

/** Characters of the name the plate carries; a name may be up to 200. */
const LABEL_MAX = 28;

/** Centred over the head, not over the tip. */
const label = (name: string, scale: number, active: boolean) => {
  const [dx, dy] = headOffset(scale);
  return new Text({
    text:
      name.length > LABEL_MAX
        ? `${name.slice(0, LABEL_MAX - 1).trimEnd()}…`
        : name,
    font: '500 11px Mulish, sans-serif',
    offsetX: dx,
    offsetY: dy - HEAD_R * scale - LABEL_GAP,
    fill: new Fill({ color: '#fff' }),
    backgroundFill: new Fill({ color: 'rgba(31, 34, 36, 0.86)' }),
    backgroundStroke: new Stroke({
      color: active ? ACCENT : 'rgba(255, 255, 255, 0.22)',
      width: 1,
    }),
    padding: [2, 5, 2, 5],
    overflow: true,
  });
};

export const spotStyle = (name: string, active: boolean) => [
  new Style({
    image: active ? activePin : savedPin,
    text: label(name, active ? SIZE.active : SIZE.saved, active),
  }),
];

export const draftPinStyle = [ring(9), new Style({ image: handPin })];

export const placingPinStyle = [ring(7), new Style({ image: cursorPin })];

/** How far outside the silhouette still counts, in css pixels. */
const GRAB_PAD = 5;

/** Whether a pixel offset *from the tip* takes hold of the pin. The anchor is
 *  the tip but the head stands ~15 px above it, so this is a box over the whole
 *  silhouette, not a radius around the coordinate. */
export const withinDraftPin = (dx: number, dy: number): boolean =>
  dx >= -GRAB_PAD &&
  dx <= (HEAD_X - TIP_X + HEAD_R) * SIZE.hand + GRAB_PAD &&
  dy <= GRAB_PAD &&
  dy >= -((TIP_Y - HEAD_Y + HEAD_R) * SIZE.hand + GRAB_PAD);
