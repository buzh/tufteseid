import { beforeAll, describe, expect, it } from 'vitest';
import {
  bboxFromMetric,
  bboxToMetric,
  bboxWidthMetres,
  MAX_SIDE_M,
  squareBboxAround,
} from '../../src/map/bbox';
import { projInit } from '../../src/map/projections/proj/projInit';

// Grid north leans further off true north the further a place lies from UTM
// 33's central meridian, so these are only worth testing across the width of
// the country. Kirkenes is 15° out — the worst Norway has.
const PLACES: [name: string, lon: number, lat: number][] = [
  ['Oslo', 10.75, 59.91],
  ['Bergen', 5.32, 60.39],
  ['Trondheim', 10.4, 63.43],
  ['Kirkenes', 30.05, 69.73],
  ['on the central meridian', 15.0, 60.0],
];

beforeAll(() => {
  projInit();
});

describe('bboxFromMetric', () => {
  it.each(PLACES)('inverts bboxToMetric at %s', (_name, lon, lat) => {
    for (const side of [50, 200, MAX_SIDE_M]) {
      const metric = bboxToMetric(squareBboxAround([lon, lat], side));
      const round = bboxToMetric(bboxFromMetric(metric));
      for (const i of [0, 1, 2, 3]) expect(round[i]).toBeCloseTo(metric[i], 2);
    }
  });

  // The bug this guards: a rectangle in hand is read, moved and written on
  // every drag frame, and a bounding-box round trip grew it by an eighth a
  // grab around Oslo and by nearly a third at Bergen.
  it.each(PLACES)('holds its size across drags at %s', (_name, lon, lat) => {
    let bbox = squareBboxAround([lon, lat], 200);
    for (let i = 0; i < 100; i += 1) {
      const [minX, minY, maxX, maxY] = bboxToMetric(bbox);
      bbox = bboxFromMetric([minX + 1, minY, maxX + 1, maxY]);
    }
    expect(bboxWidthMetres(bbox)).toBeCloseTo(200, 1);
  });

  it.each(PLACES)('keeps a square square at %s', (_name, lon, lat) => {
    const [minX, minY, maxX, maxY] = bboxToMetric(
      squareBboxAround([lon, lat], MAX_SIDE_M),
    );
    expect(maxX - minX).toBeCloseTo(MAX_SIDE_M, 2);
    expect(maxY - minY).toBeCloseTo(MAX_SIDE_M, 2);
  });
});
