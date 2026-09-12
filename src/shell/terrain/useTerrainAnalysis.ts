// Terrenganalyse: pull the float DEM for a rectangle once, then re-light and
// re-process it locally, so azimuth is a slider over data already in memory
// rather than a new WMS request.
//
// All of the tool's state lives here, mounted once from RibbonGlobalRow
// alongside useLidarControls and useFlyfotoControls — for the same reason
// those are: the controls it feeds are spread over two ribbon rows, and the
// DEM, the canvas and the render are one thing that must not exist twice.
//
// The render goes on the **map**, never in a row: map/groundOverlay.ts puts
// the canvas down as a georeferenced image layer over the background, so
// scrubbing the light re-lights the ground in place, under the Kulturminner
// layers and the lokalitet's own drawing. That slot holds one image and a
// pinned bilde wants it too, so taking it here is also what unpins a bilde —
// the arbiter is in that module.
//
// One rectangle, and it is always a lokalitet's. There used to be a second
// entrance — a free-floating rectangle framed from row 1, with a `Lagre` that
// created a lokalitet on the way out — and this hook existed partly to resolve
// the two. It is gone (docs/lokalitet-view.md §8): pressing Terreng with
// nothing open makes the lokalitet first, so by the time the DEM is fetched
// there is exactly one answer to "what am I analysing", and keeping the render
// is `Behold` like every other image.
//
// Why any of this: docs/terrain-analysis.md. The control surface:
// docs/ui-architecture.md §10.

import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalityBbox } from '../../api/localities';
import {
  activeLocalityAtom,
  coverTerrainSpecAtom,
} from '../../localities/atoms';
import type { BeholdKey, BeholdSpec } from '../../localities/behold';
import { ribbonToolAtom } from '../../localities/toolAtoms';
import {
  hideGroundOverlay,
  setGroundOverlayOpacity,
  showGroundOverlay,
} from '../../map/groundOverlay';
import type { CycleKey } from '../../map/useBackgroundCyclingKeys';
import { fetchDem, type Dem, type DemModel } from '../../terrain/dem';
import {
  clampRadius,
  DEFAULT_ALTITUDE,
  DEFAULT_AZIMUTH,
  DEFAULT_LRM_RADIUS,
  DEFAULT_SVF_RADIUS,
  DEFAULT_Z_FACTOR,
  demImageExtent,
  paintTerrainField,
  radiusRange,
  terrainField,
  terrainStaticField,
  usesHorizon,
} from '../../terrain/render';
import { computeHorizonFields, type Visualization } from '../../terrain/shade';

/**
 * The eight views, in the order the pulldown lists them and W/S walks them.
 *
 * The order is an argument about cost as much as about kinship. The two shaded
 * views come first because they are what someone arrives expecting; VAT next,
 * because it is the answer to "if I only look at one"; then the three views
 * read straight off the horizon scan, which VAT has just paid for — so a walk
 * down the ring from VAT through sky-view and both opennesses is free, where
 * the same four in any other order would each be an ~800 ms wait. Local relief
 * and slope bring up the rear as the two that answer narrower questions.
 */
export const VISUALIZATIONS: Visualization[] = [
  'hillshade',
  'multiHillshade',
  'vat',
  'svf',
  'openPos',
  'openNeg',
  'lrm',
  'slope',
];

export const useTerrainAnalysis = () => {
  const { t } = useTranslation();
  const locality = useAtomValue(activeLocalityAtom);
  const coverTerrainSpec = useAtomValue(coverTerrainSpecAtom);
  const tool = useAtomValue(ribbonToolAtom);

  // Which rectangle is being analysed, or null when the tool is not up. The
  // lokalitet's own bbox rather than a copy: that is what makes "Juster
  // området" refetch the DEM for free.
  const bbox: LocalityBbox | null =
    locality && tool === 'terrain' ? locality.bbox : null;

  const [model, setModel] = useState<DemModel>('dtm');
  const [dem, setDem] = useState<Dem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'failed' | 'empty' | null>(null);

  const [vis, setVis] = useState<Visualization>('hillshade');
  const [azimuth, setAzimuth] = useState(DEFAULT_AZIMUTH);
  const [altitude, setAltitude] = useState(DEFAULT_ALTITUDE);
  const [zFactor, setZFactor] = useState(DEFAULT_Z_FACTOR);
  // Percent, mirrored onto the layer imperatively — see groundOverlay.
  const [opacity, setOpacity] = useState(100);

  // Two radii rather than one shared, and the split is by *quantity* rather
  // than by view: how far to smooth before subtracting (LRM), versus how far
  // to look for a horizon (sky-view, both opennesses, VAT). A good value for
  // one is a poor value for the other, so switching between the two families
  // must not carry the number across — but switching *within* the horizon
  // family must, or the render would change for a reason the user did not ask
  // for and the memo below would miss its cache.
  const [lrmRadius, setLrmRadius] = useState(DEFAULT_LRM_RADIUS);
  const [svfRadius, setSvfRadius] = useState(DEFAULT_SVF_RADIUS);
  const horizonVis = usesHorizon(vis);
  // Exposed already clamped, so the slider's thumb, the number beside it, the
  // render and the caption are the same value. The *stored* number is left
  // alone, so a radius one grid caps comes back at its full value over another
  // rather than being quietly rewritten on the way past. That still happens,
  // just far less than it used to: since the horizon scan decimates instead of
  // truncating, the ceiling is a flat 24 m on any grid at 1 m or finer and
  // 24 × the cell size above that — so it only binds when a wide search dialled
  // in over a big rectangle meets the finer grid of a smaller one.
  const rawRadius = horizonVis ? svfRadius : lrmRadius;
  const radius = dem ? clampRadius(vis, dem, rawRadius) : rawRadius;
  const setRadius = useCallback(
    (value: number) => (horizonVis ? setSvfRadius : setLrmRadius)(value),
    [horizonVis],
  );

  // The visualization pulldown, shaped exactly like Standard's cartography
  // picker (useStandardControls) — for the same reason §5.2 gives there: eight
  // ways of drawing one question are a list and a ring, not eight buttons.
  const [pickerOpen, setPickerOpen] = useState(false);

  // Off-DOM: this canvas is the layer's image and the one `Behold` keeps, and
  // it is never shown in a row. React does not own it either — the OL source
  // draws from this exact element.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Whether this lokalitet's knobs have already been set from something
  // other than the defaults — the §4.6 seed below, or a Gjenskap that beat
  // it to it. Declared up here because `restoreView` closes over it.
  const seededRef = useRef(false);

  const bboxKey = bbox ? bbox.join(',') : null;

  // Fetch the DEM whenever the rectangle or the model changes. The abort
  // matters: resizing a lokalitet can retrigger this while several
  // megabytes are still in flight.
  useEffect(() => {
    if (!bbox) {
      setDem(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDem(null);
    fetchDem(bbox, { model, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result) setError('empty');
        else setDem(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('failed');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // bboxKey rather than bbox: the array is a fresh identity on every
    // record update, which would refetch on an unrelated rename.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bboxKey, model]);

  // The horizon scan, and the only genuinely expensive thing here — ~800 ms on
  // a 600² grid. Sky-view factor, both opennesses and VAT are all read off it,
  // so it gets a memo of its own **above** the static one and, critically, is
  // *not* keyed on `vis`: keying it there would make walking the ring from
  // sky-view to positive openness — a selection out of an array this already
  // holds — pay the whole pass again.
  //
  // Clamped through `'svf'` rather than through `vis` on purpose. All four
  // horizon views share one range, so this is the same number for every one of
  // them, which is exactly what lets the cache survive the walk.
  const horizonRadius = dem ? clampRadius('svf', dem, svfRadius) : svfRadius;
  const horizon = useMemo(
    () => (dem && horizonVis ? computeHorizonFields(dem, horizonRadius) : null),
    [dem, horizonVis, horizonRadius],
  );

  // Sun-independent, but cheap for everything the memo above did not already
  // do: a selection out of the triple, or LRM's box blur. Still keyed so that
  // dragging the azimuth slider — which happens dozens of times a second —
  // can never retrigger a multi-second pass. Radius is the one knob that lands
  // on this side of the line, which is why its slider commits on release
  // instead of streaming like the other four (TerrainSliders).
  const staticField = useMemo(
    () => (dem ? terrainStaticField(dem, vis, radius, horizon) : null),
    [dem, vis, radius, horizon],
  );

  // What the radius slider may offer, or null for the three views that have
  // no radius. Grid-dependent for sky-view factor — see radiusRange.
  const radiusLimits = useMemo(
    () => (dem ? radiusRange(vis, dem) : null),
    [dem, vis],
  );

  const field = useMemo(
    () =>
      dem
        ? terrainField(dem, vis, { azimuth, altitude, zFactor }, staticField)
        : null,
    [dem, vis, azimuth, altitude, zFactor, staticField],
  );

  // Paint, then hand the canvas to the map. Taking the overlay slot here is
  // also what stands a pinned bilde down (src/map/groundOverlay.ts): both are
  // an image of the same rectangle, and the render is the live one.
  useEffect(() => {
    if (!dem || !field) {
      // Covers loading, the no-coverage case, a failed fetch and leaving the
      // tool alike: an earlier render must not stay on the map describing
      // ground nothing is analysing any more.
      hideGroundOverlay('terrain');
      return;
    }
    // Reused rather than recreated: this exact element is what the map's
    // image source draws from, so replacing it every slider frame would mean
    // rebuilding the layer's image too.
    const canvas = (canvasRef.current ??= document.createElement('canvas'));
    if (!paintTerrainField(field, dem, vis, canvas)) return;
    showGroundOverlay({
      owner: 'terrain',
      source: canvas,
      crop: { x: 0, y: 0, width: canvas.width, height: canvas.height },
      extent25833: demImageExtent(dem),
    });
  }, [dem, field, vis]);

  // After the paint effect on purpose: on the commit that first builds the
  // layer, this is what gives it the slider's own position rather than
  // whatever a previous session of the tool left behind.
  useEffect(() => {
    setGroundOverlayOpacity('terrain', opacity / 100);
  }, [opacity]);

  // Unmounting the ribbon takes the layer with it — unless a bilde has taken
  // the slot in the meantime, which `hideGroundOverlay` checks for us.
  useEffect(() => () => hideGroundOverlay('terrain'), []);

  /*
   * The render as a keepable thing — and since §4.1.2 that means *the row of
   * parameters*, not the pixels. The one place that knows how a terrain
   * render becomes an attachment.
   *
   * Two verbs call it. This tool's own `Lagre`, which turns the analysed
   * rectangle into a lokalitet — and the lokalitet row's `Behold`, which is
   * the same act said once for all five grounds (docs/lokalitet-view.md
   * §4.3). It has to live here rather than there because the *state* does:
   * eight visualizations and three sliders, none of which is readable off the
   * map. What crosses to the lokalitet row is this callback.
   *
   * It used to render the figure too, and it does not any more. `renderTerrain`
   * can re-fetch this DEM and repaint this canvas from nothing but the fields
   * below, so pinning it here would be doing work the queue can do later with
   * nobody waiting — and would put a multi-second freeze behind a button whose
   * whole promise is that keeping is free.
   *
   * The corollary is that `metresPerPx` and `imageRect` are *absent* here.
   * Both are properties of pixels, and there are none yet. Writing the DEM's
   * numbers in anyway would be a small lie that survives until somebody trusts
   * `imageRect` on an unpinned record.
   *
   * Null when there is nothing to keep — no DEM yet. Callers treat that as
   * "not now", not as an error, because the only way to reach it is to press
   * the button during a fetch.
   */
  const describe = useCallback((): BeholdSpec | null => {
    if (!dem) return null;
    const label = t(`localities.terrain.vis.${vis}`);
    return {
      // Reuses the existing `extract` kind rather than adding one: this is
      // a LiDAR-derived raster of the rectangle, which is what that kind
      // already means, and a new enum value would need a PocketBase
      // migration for no user-visible gain.
      kind: 'extract',
      caption: `${label} · ${model.toUpperCase()}`,
      meta: {
        sourceLabel: t('localities.terrain.sourceLabel'),
        style: vis,
        model,
        // Not the resolution — the *rectangle*. `viewSpecOf` does not read
        // it, but the duplicate guard does (`attachmentMatchesKey`), and
        // "same ground?" has to be answerable before the pixels exist or
        // `Behold` would offer to keep the same view twice.
        bbox25833: dem.bbox25833,
        // Only meaningful for the sun-dependent views, but recording it
        // unconditionally keeps the shape predictable.
        ...(vis === 'hillshade' ? { azimuth } : {}),
        altitude,
        zFactor,
        // Already clamped to the grid — see above. The pin clamps again
        // against whatever grid it actually gets, and writes back.
        ...(radiusLimits ? { radius } : {}),
      },
    };
  }, [dem, vis, model, azimuth, altitude, zFactor, radius, radiusLimits, t]);

  /*
   * The same render, said as the duplicate guard's key (§4.3): what `Behold`
   * compares against the bilder already kept, so scrubbing the azimuth back
   * to a light you have already saved reads `Beholdt` instead of saving it
   * twice.
   *
   * Every field here is one `describe` writes into `meta` — kept adjacent for
   * that reason, because a key that drifts from the record it is matching
   * against silently stops matching anything. That the guard reads only spec
   * fields is what lets it work on an unpinned View, which is now most of
   * them.
   */
  const beholdKey = useMemo((): BeholdKey | null => {
    if (!dem) return null;
    return {
      kind: 'terrain',
      // A terrain render has no WMS dataset to name — that absence is what
      // tells it from a LiDAR extract, which shares its attachment kind.
      sourceKey: '',
      style: vis,
      model,
      params: {
        ...(vis === 'hillshade' ? { azimuth } : {}),
        altitude,
        zFactor,
        ...(radiusLimits ? { radius } : {}),
      },
    };
  }, [dem, vis, model, azimuth, altitude, zFactor, radius, radiusLimits]);

  // Clicking a row picks *and* dismisses; W/S below picks without closing, so
  // the selection can be walked down an open list. Same split as the other
  // three pulldowns.
  const activate = (next: Visualization) => {
    setVis(next);
    setPickerOpen(false);
  };

  /**
   * Put every knob back where a saved render had it — Gjenskap's terrain arm
   * (`useRecreateView`).
   *
   * A method rather than the caller setting the six pieces itself, which is
   * how the LiDAR and flyfoto arms work, because `setRadius` is not a plain
   * setter: it routes to one of *two* stored radii depending on the current
   * visualization (see the split above). A caller outside this hook would
   * hand its number to whichever family was showing a moment ago, since the
   * `vis` it just set is not visible until the next render. From in here the
   * target visualization is simply an argument.
   *
   * It also stands the §4.6 seed down — see `seededRef` below. An explicit
   * "put me back here" and an automatic "start from what they saw" are the
   * same write, so the explicit one has to be able to say it happened.
   */
  const restoreView = useCallback(
    (v: {
      vis: Visualization;
      model: DemModel;
      azimuth: number;
      altitude: number;
      zFactor: number;
      radius?: number;
    }) => {
      seededRef.current = true;
      setModel(v.model);
      setVis(v.vis);
      setAzimuth(v.azimuth);
      setAltitude(v.altitude);
      setZFactor(v.zFactor);
      if (v.radius != null) {
        (usesHorizon(v.vis) ? setSvfRadius : setLrmRadius)(v.radius);
      }
    },
    [],
  );

  /*
   * §4.6 — entering Terreng over a lokalitet that already has a terrain
   * render starts from *that render's* settings rather than from the app
   * defaults, so pressing 5 on somebody else's site shows you what they saw,
   * live and full-size, before you move a knob.
   *
   * Once per lokalitet, not once per entry: the second visit must not throw
   * away knobs you deliberately moved on the first.
   *
   * `restoreView` sets the flag too, and that is what settles the one race
   * here. Gjenskap on a terrain bilde calls `restoreView` and *then* enters
   * the ground, so the tool flips to 'terrain' in the same commit as the
   * knobs it just set — without this the seed would fire immediately after
   * and overwrite the image the user actually asked for with the cover's.
   */
  //
  // …with one lokalitet change that is not one: `Lag min kopi` (§7) swaps you
  // to a fork of the site you were reading, and the likeliest path in the
  // whole design ends there — open a shared site, dial up a better azimuth,
  // copy it so you can keep the render. The rectangle is identical, so the
  // DEM survives the swap for free (`bboxKey`); re-seeding would throw away
  // the knobs that were the reason for copying, from the cover render of the
  // very site those knobs were an improvement on.
  //
  // Before the seed effect on purpose: effects run in declaration order, so
  // on the commit where the lokalitet changes this clears the flag and the
  // one below then seeds from the new record's cover.
  const previousLocalityId = useRef(locality?.id ?? null);
  useEffect(() => {
    const from = previousLocalityId.current;
    const id = locality?.id ?? null;
    // Depended on the whole record rather than its id, because `derivedFrom`
    // is what has to be read — so the no-op case has to be checked by hand:
    // the atom gets a fresh object on every rename and every bbox drag.
    if (id === from) return;
    previousLocalityId.current = id;
    if (locality && from && locality.derivedFrom === from) return;
    seededRef.current = false;
  }, [locality]);

  useEffect(() => {
    if (tool !== 'terrain' || !coverTerrainSpec || seededRef.current) return;
    restoreView(coverTerrainSpec);
  }, [tool, coverTerrainSpec, restoreView]);

  // Called by useGroundMode when Terreng stops being the ground on screen. An
  // unmounted popover never fires its own open-change callback, so without
  // this it would come back open.
  const standDown = useCallback(() => setPickerOpen(false), []);

  // Terreng's ring, walked by W/S. Terreng used to be the one ground with none
  // — "a client-side render has no dataset" — which was true when there were
  // five views on a segmented control and false the moment there were eight.
  // The visualizations *are* its dataset: one question about this ground,
  // answered eight ways, exactly like Standard's five cartographies.
  //
  // Walking it while watching the terrain is the illumination-independent
  // counterpart to sweeping the azimuth, and it is cheap in the order
  // VISUALIZATIONS lists them — see the note there.
  const cycle = (key: CycleKey): boolean => {
    // E toggles the model here as it does in LiDAR, since Terreng has the same
    // DTM/DOM pair on its strip. A/D have no terrain analogue.
    if (key === 'e') {
      setModel((current) => (current === 'dtm' ? 'dom' : 'dtm'));
      return true;
    }
    if (key !== 'w' && key !== 's') return false;
    const step = key === 's' ? 1 : -1;
    const at = VISUALIZATIONS.indexOf(vis);
    const ring = VISUALIZATIONS.length;
    setVis(VISUALIZATIONS[(at + step + ring) % ring]);
    return true;
  };

  return {
    cycle,
    standDown,
    pickerOpen,
    setPickerOpen,
    activate,
    restoreView,
    model,
    setModel,
    // No bare `setVis`: the two ways in are `activate` (a row click, which
    // also dismisses) and `cycle` (W/S, which does not).
    vis,
    dem,
    loading,
    error,
    // What the lokalitet row's `Behold` needs from this tool, and all it
    // needs: what the render *is*, and how to tell whether it is already in
    // the Bilder. Published through `beholdOfferAtom`, not props — row 1 and
    // the lokalitet row are siblings.
    describe,
    beholdKey,
    azimuth,
    setAzimuth,
    altitude,
    setAltitude,
    zFactor,
    setZFactor,
    radius,
    setRadius,
    radiusLimits,
    opacity,
    setOpacity,
  };
};

export type TerrainAnalysis = ReturnType<typeof useTerrainAnalysis>;
