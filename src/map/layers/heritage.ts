import { atom } from 'jotai';
import {
  getUrlParameter,
  removeUrlParameter,
  setUrlParameter,
} from '../../shared/utils/urlUtils';

/*
 * How the Kulturminner overlay is drawn — the settings behind the picker in
 * ribbon row 1, and the WMS parameters they turn into.
 *
 * All of it is one service, `/wms/ra/kulturminner2`, asked for a different
 * LAYERS/STYLES pair. The config still names its *root* layer, so the app
 * used to have exactly one knob: on or off. Underneath, RA publishes six
 * sublayers and a style list per sublayer, and this module is the map between
 * the two.
 *
 * Everything below was read off the live GetCapabilities and confirmed with
 * GetMap probes (2026-09), because the failure modes are quiet in one
 * direction and loud in the other and neither is obvious from the document:
 *
 * - A style the layer does not publish is a **ServiceException**, i.e. a
 *   broken tile rather than a blank one. Loud, but still a wall of red Xs, so
 *   the tables below are exhaustive rather than defaulted.
 * - A style it *does* publish but that matches nothing here is a valid, fully
 *   transparent PNG. Indistinguishable from "no data", which is correct: the
 *   vern renders are subsets, and an empty subset is an answer.
 */

// ---------------------------------------------------------------------------
// The settings
// ---------------------------------------------------------------------------

/**
 * Which of the three registers inside kulturminner2 to draw. Separate
 * switches because they answer different questions: the lokalitet is the area
 * someone recorded, the enkeltminne is the individual feature in it, and the
 * sikringssone is the legal buffer around it — a band of colour that follows
 * the lokalitet's outline and, filled, hides exactly the ground you turned the
 * LiDAR on to read.
 */
export const HERITAGE_DETAILS = [
  'lokaliteter',
  'enkeltminner',
  'sikringssoner',
] as const;

export type HeritageDetail = (typeof HERITAGE_DETAILS)[number];

/**
 * One axis, not two, because the WMS makes it one: STYLES takes a single
 * value per LAYERS entry, and RA publishes no filled variant of any subset.
 * So "filled" and "only the automatically protected ones" cannot both be
 * asked for, and a UI offering them as separate controls would be promising
 * a request that does not exist.
 *
 * The first two are ways of drawing everything; the rest are subsets, drawn
 * as outlines. Order is the order they appear in the picker.
 */
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

// ---------------------------------------------------------------------------
// The WMS tables
// ---------------------------------------------------------------------------

type Sublayer = {
  /** WMS layer name, as published by kulturminner2. */
  name: string;
  /**
   * STYLES value per render. A missing entry means the sublayer cannot
   * express that render and is left out of the request entirely — asking for
   * it anyway is the ServiceException case.
   */
  styles: Partial<Record<HeritageRender, string>>;
};

/**
 * Vern styles shared by the four sublayers that carry a `vernetype` column.
 * Spelled out rather than derived from the render name: `Uavklart` is
 * capitalized on Lokalitetsikoner and nowhere else, which is the kind of thing
 * a clever mapping gets wrong once and then never again visibly.
 */
const VERN: Partial<Record<HeritageRender, string>> = {
  fredede: 'fredede',
  verneverdige: 'verneverdige',
  listefoerte: 'listefoerte',
  utenVern: 'uten_vern',
  uavklart: 'uavklart',
};

/**
 * Each detail expands to the polygon layer *and* its icon twin, in that
 * order. The pairing is load-bearing rather than decorative: the polygon
 * layers stop rendering at 1:25 000 (`MaxScaleDenominator`) while the icons
 * carry to 1:450 000, so a request for the polygons alone empties the map the
 * moment you zoom out past a neighbourhood. Sikringssoner has no twin and
 * simply disappears up there, which is the right answer for a buffer you can
 * no longer see the thing it buffers.
 */
const DETAIL_SUBLAYERS: Record<HeritageDetail, Sublayer[]> = {
  lokaliteter: [
    {
      name: 'Lokaliteter',
      styles: { omriss: '', flate: 'heldekkende', ...VERN },
    },
    // No fill and no outline variant: an icon is an icon. `Uavklart` is the
    // odd spelling mentioned above.
    {
      name: 'Lokalitetsikoner',
      styles: { omriss: '', flate: '', ...VERN, uavklart: 'Uavklart' },
    },
  ],
  enkeltminner: [
    // Inverted relative to Lokaliteter, and this is the trap: the *default*
    // style is the filled one, and `grenser` is the outline. A shared "fill
    // means heldekkende" rule would draw enkeltminner solid whichever way the
    // toggle was set.
    {
      name: 'Enkeltminner',
      styles: { omriss: 'grenser', flate: 'inspire_common:DEFAULT', ...VERN },
    },
    { name: 'Enkeltminneikoner', styles: { omriss: '', flate: '', ...VERN } },
  ],
  sikringssoner: [
    // No vern styles and no `vernetype` column — a sikringssone inherits its
    // protection from the lokalitet it surrounds rather than carrying one. So
    // it drops out of the request under any subset render, which also reads
    // correctly: you asked to see the fredede sites, not their buffers.
    {
      name: 'Sikringssoner',
      styles: { omriss: 'inspire_common:DEFAULT', flate: 'heldekkende' },
    },
  ],
};

/**
 * The `LAYERS`/`STYLES` pair for the current settings, or null when the
 * combination selects nothing at all — every detail switched off, or only
 * Sikringssoner left under a vern subset. Null means hide the layer rather
 * than send a request that can only come back empty.
 *
 * Both lists are positional and must stay the same length; that is the whole
 * contract with the WMS, and it is why they are built in one pass.
 */
export const heritageSitesParams = (
  details: ReadonlySet<HeritageDetail>,
  render: HeritageRender,
): { LAYERS: string; STYLES: string } | null => {
  const names: string[] = [];
  const styles: string[] = [];
  for (const detail of HERITAGE_DETAILS) {
    if (!details.has(detail)) continue;
    for (const sublayer of DETAIL_SUBLAYERS[detail]) {
      const style = sublayer.styles[render];
      if (style === undefined) continue;
      names.push(sublayer.name);
      styles.push(style);
    }
  }
  if (names.length === 0) return null;
  return { LAYERS: names.join(','), STYLES: styles.join(',') };
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Read through getUrlParameter rather than getListUrlParameter: the list
// helper cannot tell an absent parameter from an empty one, and "no details"
// is a state the picker can reach — it would come back as "all details" on
// the next load.
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
  // Not `Number(getUrlParameter(...))` on its own: Number(null) is 0, which is
  // finite, so an absent parameter would clamp to the minimum and every cold
  // load without the parameter would come up nearly invisible.
  const raw = getUrlParameter('heritageOpacity');
  const value = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(MIN_HERITAGE_OPACITY, value));
};

export const heritageDetailsAtom = atom<Set<HeritageDetail>>(readDetails());

/**
 * Outlines by default, where the service's own default fills enkeltminner in
 * cyan. Deliberate: the register is here to be read *against* the relief, and
 * a filled polygon is an opaque lid over the one thing the app exists to show.
 */
export const heritageRenderAtom = atom<HeritageRender>(readRender());

export const heritageOpacityAtom = atom<number>(readOpacity());

/**
 * URL persistence, written from the layer effect rather than from the setters
 * so a link always describes what is actually on the map. Defaults are
 * *removed* rather than written, keeping a shared URL down to what the sender
 * changed.
 */
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
