// How a spot is drawn: the pin, and the label that names it.
//
// One file, because the pin riding the cursor, the pin in the reader's hand and
// the pin standing in a saved record have to be recognisably the same object.
// What separates them is size, a ring on the ground and whether a name hangs
// over it — never a different marker.
//
// It is a physical pin rather than a cartographic teardrop: a papaya head on a
// steel shaft, leaning, with its point at the coordinate. The lean is the whole
// reason for the shape — a symmetrical marker stands on top of the mound it is
// marking, where this one stands beside it and points at it — and the tip says
// without arguing which pixel the record means. Cased in white and edged in
// black, because the same pin is read against hillshade, autumn birch and snow
// in one session.

import {
  Circle as CircleStyle,
  Fill,
  Icon,
  Stroke,
  Style,
  Text,
} from 'ol/style';

// The pin takes z-index 6: over the terrain analysis and its frame (4), under
// the Kulturminner theme layers (10), because a heritage polygon is the record
// the reader is checking their own spot against and it should not be hidden by
// it. The inventory of what is where is in docs/map-layers.md; 5 and 7–9 are
// what is left.
export const PIN_Z_INDEX = 6;

const ACCENT = '#ff6a00';

// The drawing, in its own units. Everything else in here — the anchor, where
// the label hangs, how near counts as taking hold — is derived from these five
// numbers rather than measured off the picture a second time.
const W = 22;
const H = 27;
/** The point it is stuck through, and the anchor. */
const TIP_X = 5.2;
const TIP_Y = 25.2;
/** The head, up and to the right of the tip. */
const HEAD_X = 14.8;
const HEAD_Y = 6.6;
const HEAD_R = 5;

/** The shaft: a wedge from either side of the head down to the tip. */
const SHAFT = `M13.29 5.82 L16.31 7.38 L${TIP_X} ${TIP_Y} Z`;

// Drawn twice: a white casing under the whole silhouette, then the pin itself
// over it with a thin dark edge. One pass would be legible against either a
// dark ground or a bright one, never both.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2}" viewBox="0 0 ${W} ${H}">\
<g stroke-linejoin="round" stroke-linecap="round">\
<path d="${SHAFT}" fill="#fff" stroke="#fff" stroke-width="2.6" opacity=".92"/>\
<circle cx="${HEAD_X}" cy="${HEAD_Y}" r="${HEAD_R}" fill="#fff" stroke="#fff" stroke-width="2.6" opacity=".92"/>\
<path d="${SHAFT}" fill="#cfd4da" stroke="rgba(0,0,0,.45)" stroke-width=".7"/>\
<circle cx="${HEAD_X}" cy="${HEAD_Y}" r="${HEAD_R}" fill="${ACCENT}" stroke="rgba(0,0,0,.35)" stroke-width=".7"/>\
<circle cx="${HEAD_X - 1.8}" cy="${HEAD_Y - 1.8}" r="1.4" fill="#fff" opacity=".45"/>\
</g></svg>`;

const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * The raster the browser makes of that markup is the `width`/`height` on it,
 * and it is drawn at twice the size the pin is worn at so a retina screen has
 * pixels to use. Every scale below is therefore halved on its way into `Icon`.
 */
const HIDPI = 2;

/**
 * How large the pin is drawn, as a multiple of the units above — so `saved` is
 * a pin 19 css pixels wide and 23 tall. Smaller than this and the shaft stops
 * being a shaft: the head is legible down to about six pixels across, the taper
 * under it is not.
 */
const SIZE = { saved: 0.85, active: 1, hand: 1.08 };

// Hoisted, not built per feature: the style function runs for every pin on
// every redraw, and an `Icon` carries the decoded image with it.
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
/** Not yet stuck in: the same pin, a shade of the way towards the ground under it. */
const cursorPin = pinIcon(SIZE.hand, 0.85);

/** The ring the tip stands in while the pin is the reader's to move. It is
 *  drawn at the anchor, so it also says which pixel the pin is pointing at
 *  during the one gesture where that is being decided. */
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

/**
 * How much of a name the plate carries. A name is allowed 200 characters and a
 * few readers will use them; a label as wide as the map is a label that hides
 * the map. The whole of it is in the card the pin opens.
 */
const LABEL_MAX = 28;

/**
 * The name, on a plate over the head rather than outlined against the ground.
 * A plate hides a little relief, which is the cost; what it buys is a name that
 * is still a name over ortofoto, where white-on-outline turns to noise. It is
 * centred over the head and not over the tip, so the label and the thing it
 * names read as one object.
 */
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

/** A saved spot, with its name over it. */
export const spotStyle = (name: string, active: boolean) => [
  new Style({
    image: active ? activePin : savedPin,
    text: label(name, active ? SIZE.active : SIZE.saved, active),
  }),
];

/** The pin while it is in the reader's hand. No label: what it is called is
 *  being typed in the box beside it, a character at a time. */
export const draftPinStyle = [ring(9), new Style({ image: handPin })];

/** The pin while it is still on the cursor, before a click has put it down. */
export const placingPinStyle = [ring(7), new Style({ image: cursorPin })];

/** How far outside the silhouette still counts. */
const GRAB_PAD = 5;

/**
 * Whether a pixel offset from the tip counts as taking hold of the pin.
 *
 * The whole pin is the handle, not its point: a reader dragging a marker aims
 * at the head, which is fifteen pixels above the coordinate the feature is at.
 * A box rather than the silhouette, because the difference between them is a
 * few pixels of air beside a shaft and nothing else is up there to hit.
 */
export const withinDraftPin = (dx: number, dy: number): boolean =>
  dx >= -GRAB_PAD &&
  dx <= (HEAD_X - TIP_X + HEAD_R) * SIZE.hand + GRAB_PAD &&
  dy <= GRAB_PAD &&
  dy >= -((TIP_Y - HEAD_Y + HEAD_R) * SIZE.hand + GRAB_PAD);
