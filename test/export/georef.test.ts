import { describe, expect, it } from 'vitest';
import { CRS_WKT, worldExtension, worldFile } from '../../src/export/georef';
import type { Metric } from '../../src/map/bbox';

// A 500 m square — the largest footprint the app allows — at 0.25 m/px.
const BBOX: Metric = [250000, 6650000, 250500, 6650500];
const SIDE_PX = 2000;

const linesOf = (bbox: Metric, w: number, h: number): number[] => {
  const text = worldFile(bbox, w, h);
  if (!text) throw new Error('no world file');
  return text.trimEnd().split('\n').map(Number);
};

describe('worldFile', () => {
  it('writes six lines', () => {
    expect(linesOf(BBOX, SIDE_PX, SIDE_PX)).toHaveLength(6);
  });

  it('measures the pixel off the image, not a stored resolution', () => {
    const [xRes, , , yRes] = linesOf(BBOX, SIDE_PX, SIDE_PX);
    expect(xRes).toBeCloseTo(0.25, 10);
    expect(yRes).toBeCloseTo(-0.25, 10);
  });

  // Rows run down the image and northings run up the grid.
  it('negates the y pixel size and leaves the rotations at zero', () => {
    const [, rotY, rotX, yRes] = linesOf(BBOX, SIDE_PX, SIDE_PX);
    expect(rotY).toBe(0);
    expect(rotX).toBe(0);
    expect(yRes).toBeLessThan(0);
  });

  // A world file names the centre of the top-left pixel, not its corner: half
  // a pixel out is a whole pixel of misregistration against the ground.
  it('anchors on the centre of the top-left pixel', () => {
    const [, , , , originX, originY] = linesOf(BBOX, SIDE_PX, SIDE_PX);
    expect(originX).toBeCloseTo(250000 + 0.125, 6);
    expect(originY).toBeCloseTo(6650500 - 0.125, 6);
  });

  it('takes the two axes independently', () => {
    const [xRes, , , yRes] = linesOf(BBOX, 1000, 500);
    expect(xRes).toBeCloseTo(0.5, 10);
    expect(yRes).toBeCloseTo(-1, 10);
  });

  it('refuses a rectangle or an image with no extent', () => {
    expect(worldFile(BBOX, 0, SIDE_PX)).toBeNull();
    expect(worldFile(BBOX, SIDE_PX, 0)).toBeNull();
    expect(worldFile([250000, 6650000, 250000, 6650500], 10, 10)).toBeNull();
  });

  // Eastings run to seven figures, so millimetres need ten decimals.
  it('keeps enough decimals for a millimetre at UTM 33 eastings', () => {
    const text = worldFile(BBOX, SIDE_PX, SIDE_PX);
    expect(text?.split('\n')[0]).toBe('0.2500000000');
  });
});

describe('worldExtension', () => {
  it('names the sidecar GDAL looks for beside each raster type', () => {
    expect(worldExtension('png')).toBe('pgw');
    expect(worldExtension('jpg')).toBe('jgw');
    expect(worldExtension('webp')).toBe('wld');
  });
});

describe('CRS_WKT', () => {
  it('is EPSG:25833 with UTM 33 north parameters', () => {
    expect(CRS_WKT).toContain('AUTHORITY["EPSG","25833"]');
    expect(CRS_WKT).toContain('PARAMETER["central_meridian",15]');
    expect(CRS_WKT).toContain('PARAMETER["false_easting",500000]');
  });
});
