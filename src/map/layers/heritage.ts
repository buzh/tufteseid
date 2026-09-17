import { atom } from 'jotai';
import {
  getUrlParameter,
  removeUrlParameter,
  setUrlParameter,
} from '../../shared/utils/urlUtils';

// The picker's settings mapped onto `/wms/ra/kulturminner2`'s six sublayers and
// their per-sublayer styles. Exhaustive rather than defaulted: a style a
// sublayer does not publish is a ServiceException, i.e. a broken tile, while a
// published style matching nothing is a transparent PNG.

// ---- The settings ----

// The three registers inside kulturminner2: the recorded area, the individual
// feature in it, and the legal buffer around it.
export const HERITAGE_DETAILS = [
  'lokaliteter',
  'enkeltminner',
  'sikringssoner',
] as const;

export type HeritageDetail = (typeof HERITAGE_DETAILS)[number];

// One axis, not two: STYLES takes one value per LAYERS entry and RA publishes
// no filled variant of any subset. The first two draw everything.
export const HERITAGE_RENDERS = [
  'omriss',
  'flate',
  'fredede',
  'verneverdige',
  'listefoerte',
  'utenVern',
  'uavklart',
] as const;

export type HeritageRender = (typeof HERITAGE_RENDERS)[number];

/** The subsets, i.e. everything after the two whole-register renders. */
export const HERITAGE_VERN_RENDERS = HERITAGE_RENDERS.slice(
  2,
) as readonly HeritageRender[];

// ---- The WMS tables ----

type Sublayer = {
  name: string;
  // A missing entry drops the sublayer from the request.
  styles: Partial<Record<HeritageRender, string>>;
};

// Vern styles for the four sublayers carrying a `vernetype` column, spelled out
// rather than derived: `Uavklart` is capitalized on Lokalitetsikoner alone.
const VERN: Partial<Record<HeritageRender, string>> = {
  fredede: 'fredede',
  verneverdige: 'verneverdige',
  listefoerte: 'listefoerte',
  utenVern: 'uten_vern',
  uavklart: 'uavklart',
};

// Each detail expands to the polygon layer and its icon twin (request order is
// `PAINT_ORDER`): polygons stop at 1:25 000 (`MaxScaleDenominator`), icons at
// 1:450 000.
const DETAIL_SUBLAYERS: Record<HeritageDetail, Sublayer[]> = {
  lokaliteter: [
    {
      name: 'Lokaliteter',
      styles: { omriss: '', flate: 'heldekkende', ...VERN },
    },
    // No fill and no outline variant, and the odd `Uavklart` spelling.
    {
      name: 'Lokalitetsikoner',
      styles: { omriss: '', flate: '', ...VERN, uavklart: 'Uavklart' },
    },
  ],
  enkeltminner: [
    // Inverted: the default style is the filled one, `grenser` the outline.
    {
      name: 'Enkeltminner',
      styles: { omriss: 'grenser', flate: 'inspire_common:DEFAULT', ...VERN },
    },
    { name: 'Enkeltminneikoner', styles: { omriss: '', flate: '', ...VERN } },
  ],
  sikringssoner: [
    // No `vernetype` column, so it drops out under any subset render.
    {
      name: 'Sikringssoner',
      styles: { omriss: 'inspire_common:DEFAULT', flate: 'heldekkende' },
    },
  ],
};

// The WMS paints LAYERS in order, so the last name wins the pixel. Icons last:
// a click aims at those.
const PAINT_ORDER: readonly string[] = [
  'Sikringssoner',
  'Lokaliteter',
  'Enkeltminner',
  'Lokalitetsikoner',
  'Enkeltminneikoner',
];

/**
 * The `LAYERS`/`STYLES` pair for the current settings, or null when the
 * combination selects nothing. The two lists are positional and equal length.
 */
export const heritageSitesParams = (
  details: ReadonlySet<HeritageDetail>,
  render: HeritageRender,
): { LAYERS: string; STYLES: string } | null => {
  const picked: { name: string; style: string }[] = [];
  for (const detail of HERITAGE_DETAILS) {
    if (!details.has(detail)) continue;
    for (const sublayer of DETAIL_SUBLAYERS[detail]) {
      const style = sublayer.styles[render];
      if (style === undefined) continue;
      picked.push({ name: sublayer.name, style });
    }
  }
  if (picked.length === 0) return null;
  picked.sort(
    (a, b) => PAINT_ORDER.indexOf(a.name) - PAINT_ORDER.indexOf(b.name),
  );
  return {
    LAYERS: picked.map((p) => p.name).join(','),
    STYLES: picked.map((p) => p.style).join(','),
  };
};

// ---- State ----

// getUrlParameter, not getListUrlParameter: the list helper reads absent and
// empty alike, so "no details" would come back as "all details".
const readDetails = (): Set<HeritageDetail> => {
  const fromUrl = getUrlParameter('heritageDetails');
  if (fromUrl === null) return new Set(HERITAGE_DETAILS);
  const known = fromUrl
    .split(',')
    .filter((d): d is HeritageDetail =>
      (HERITAGE_DETAILS as readonly string[]).includes(d),
    );
  return new Set(known);
};

const readRender = (): HeritageRender => {
  const fromUrl = getUrlParameter('heritageRender');
  return (HERITAGE_RENDERS as readonly string[]).includes(fromUrl ?? '')
    ? (fromUrl as HeritageRender)
    : 'omriss';
};

export const MIN_HERITAGE_OPACITY = 0.2;

const readOpacity = (): number => {
  // Number(null) is 0 and finite, so an absent parameter would clamp to MIN.
  const raw = getUrlParameter('heritageOpacity');
  const value = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(MIN_HERITAGE_OPACITY, value));
};

export const heritageDetailsAtom = atom<Set<HeritageDetail>>(readDetails());

// Outlines by default, against RA's own filled enkeltminner: a fill is a lid
// over the relief the register is read against.
export const heritageRenderAtom = atom<HeritageRender>(readRender());

export const heritageOpacityAtom = atom<number>(readOpacity());

// A blind, not a switch: separate from `activeThemeLayersAtom` so hiding keeps
// the ticked sources. Not URL-persisted, so a shared link arrives visible.
export const heritageHiddenAtom = atom(false);

// Called from the layer effect rather than the setters, so a link describes
// what is on the map. Defaults are removed rather than written.
export const writeHeritageUrlParameters = (
  details: ReadonlySet<HeritageDetail>,
  render: HeritageRender,
  opacity: number,
): void => {
  if (details.size === HERITAGE_DETAILS.length) {
    removeUrlParameter('heritageDetails');
  } else {
    setUrlParameter(
      'heritageDetails',
      HERITAGE_DETAILS.filter((d) => details.has(d)).join(','),
    );
  }
  if (render === 'omriss') removeUrlParameter('heritageRender');
  else setUrlParameter('heritageRender', render);
  if (opacity >= 1) removeUrlParameter('heritageOpacity');
  else setUrlParameter('heritageOpacity', opacity.toFixed(2));
};
