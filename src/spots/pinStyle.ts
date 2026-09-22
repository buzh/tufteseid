// How a spot is drawn. One file, because the pin being placed and the pin
// standing still have to be recognisably the same object — the difference
// between them is a ring saying "this one is in your hand", not a different
// marker.
//
// Papaya, like every other accent in the app, and cased in white: the pin is
// read against hillshade and ortofoto as often as against cartography, and an
// uncased orange dot disappears into autumn birch.

import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style';

// The pin takes z-index 6: over the terrain analysis and its frame (4), under
// the Kulturminner theme layers (10), because a heritage polygon is the record
// the reader is checking their own spot against and it should not be hidden by
// it. The inventory of what is where is in docs/map-layers.md; 5 and 7–9 are
// what is left.
export const PIN_Z_INDEX = 6;

const ACCENT = 'rgba(255, 106, 0, 0.95)';
const CASING = 'rgba(255, 255, 255, 0.9)';

const dot = (radius: number, casing: number) =>
  new CircleStyle({
    radius,
    fill: new Fill({ color: ACCENT }),
    stroke: new Stroke({ color: CASING, width: casing }),
  });

/** The pin while it is in the reader's hand: bigger, with a halo around it. */
export const draftPinStyle = [
  new Style({
    image: new CircleStyle({
      radius: 13,
      fill: new Fill({ color: 'rgba(255, 106, 0, 0.18)' }),
      stroke: new Stroke({ color: 'rgba(255, 106, 0, 0.5)', width: 1 }),
    }),
  }),
  new Style({ image: dot(7, 2) }),
];

/** A saved spot, with its name beside it. */
export const spotStyle = (name: string, active: boolean) => [
  new Style({
    image: dot(active ? 7 : 5, 2),
    text: new Text({
      text: name,
      font: '500 12px Mulish, sans-serif',
      offsetY: -16,
      fill: new Fill({ color: '#fff' }),
      // A halo rather than a plate: a label box over relief hides the relief,
      // and the name is short enough that an outline carries it.
      stroke: new Stroke({ color: 'rgba(0, 0, 0, 0.75)', width: 3 }),
      overflow: true,
    }),
  }),
];
