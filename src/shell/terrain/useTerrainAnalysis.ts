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
// Two entrances resolve to one rectangle here rather than in two callers. A
// lokalitet's Terreng analyses its bbox and saves into its Bilder; row 1's
// Terreng with nothing open analyses the visible map and turns that rectangle
// into a lokalitet on the way out. They can never both be live: opening a
// lokalitet clears the standalone rectangle.
//
// Why any of this: docs/terrain-analysis.md. The control surface:
// docs/ui-architecture.md §10.

import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createAttachment } from '../../api/attachments';
import type { LocalityBbox } from '../../api/localities';
import { currentUserAtom } from '../../auth/atoms';
import { isAuthDialogOpenAtom } from '../../auth/atoms-dialog';
import { renderFigureBlob } from '../../figure/figure';
import { terrainFigure } from '../../figure/specs';
import {
  activeLocalityAtom,
  coverTerrainSpecAtom,
  editingLocalityIdAtom,
  pendingStarterLocalityIdAtom,
} from '../../localities/atoms';
import type { BeholdKey, BeholdProduct } from '../../localities/behold';
import { createLocalityFromBbox } from '../../localities/createFromBbox';
import { ribbonToolAtom } from '../../localities/toolAtoms';
import {
  hideGroundOverlay,
  setGroundOverlayOpacity,
  showGroundOverlay,
} from '../../map/groundOverlay';
import type { CycleKey } from '../../map/useBackgroundCyclingKeys';
import { terrainStandaloneBboxAtom } from '../../terrain/atoms';
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
import { useTerrainViewport } from '../../terrain/useTerrainViewport';
import { toast } from '../../ui';

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
  const user = useAtomValue(currentUserAtom);
  const openAuthDialog = useSetAtom(isAuthDialogOpenAtom);
  const locality = useAtomValue(activeLocalityAtom);
  const setActiveLocality = useSetAtom(activeLocalityAtom);
  const setEditingLocalityId = useSetAtom(editingLocalityIdAtom);
  const setPendingStarter = useSetAtom(pendingStarterLocalityIdAtom);
  const coverTerrainSpec = useAtomValue(coverTerrainSpecAtom);
  const tool = useAtomValue(ribbonToolAtom);
  const standaloneBbox = useAtomValue(terrainStandaloneBboxAtom);
  // Only the standalone entrance can re-frame; with a lokalitet open the
  // rectangle is the lokalitet's, and "Juster området" in the lokalitet row
  // owns it.
  const { frame } = useTerrainViewport();

  // Which rectangle is being analysed, or null when the tool is not up. The
  // lokalitet's own bbox rather than a copy: that is what makes "Juster
  // området" refetch the DEM for free.
  const bbox: LocalityBbox | null = locality
    ? tool === 'terrain'
      ? locality.bbox
      : null
    : standaloneBbox;

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
  // alone: a 20 m sky-view radius that a 0.25 m grid caps at 6 m should come
  // back at 20 m over a 1 m one, not be quietly rewritten on the way past.
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

  const [saving, setSaving] = useState(false);
  // Off-DOM: this canvas is the layer's image and the blob "Lagre" keeps, and
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
   * The render as a keepable thing: the figure plus every record field that
   * describes it. The one place that knows how a terrain render becomes an
   * attachment.
   *
   * Two verbs call it. This tool's own `Lagre`, which turns the analysed
   * rectangle into a lokalitet — and the lokalitet row's `Behold`, which is
   * the same act said once for all five grounds (docs/lokalitet-view.md
   * §4.3). It has to live here rather than there because the pixels do: the
   * canvas is owned by this hook and re-painted every slider frame, so what
   * crosses to the lokalitet row is this callback, not an image.
   *
   * Null when there is nothing to keep — no DEM yet, or the figure renderer
   * declined. Callers treat that as "not now", not as an error, because the
   * only way to reach it is to press the button during a fetch.
   */
  const produce = useCallback(
    async (subject?: string): Promise<BeholdProduct | null> => {
      const canvas = canvasRef.current;
      if (!canvas || !dem) return null;

      // What leaves the app is a figure, not a screengrab of the overlay:
      // a hillshade at 315°/35° and one at 135°/20° disagree about whether
      // there is a mound in that field, so the angles travel with the pixels.
      const figure = await renderFigureBlob(
        canvas,
        terrainFigure({
          subject,
          vis,
          model,
          light: { azimuth, altitude, zFactor },
          dem,
          radius,
        }),
      );
      if (!figure) return null;

      const label = t(`localities.terrain.vis.${vis}`);
      return {
        // Reuses the existing `extract` kind rather than adding one: this is
        // a LiDAR-derived raster of the rectangle, which is what that kind
        // already means, and a new enum value would need a PocketBase
        // migration for no user-visible gain.
        kind: 'extract',
        blob: figure.blob,
        caption: `${label} · ${model.toUpperCase()}`,
        filename: `terreng_${vis}_${model}.png`,
        meta: {
          sourceLabel: t('localities.terrain.sourceLabel'),
          style: vis,
          model,
          metresPerPx: dem.metresPerPx,
          bbox25833: dem.bbox25833,
          // Where the render sits inside the file: the caption panel is
          // drawn below it, so the image is no longer the whole PNG.
          imageRect: figure.imageRect,
          // Only meaningful for the sun-dependent views, but recording it
          // unconditionally keeps the shape predictable.
          ...(vis === 'hillshade' ? { azimuth } : {}),
          altitude,
          zFactor,
          // Already clamped to the grid — see above.
          ...(radiusLimits ? { radius } : {}),
        },
      };
    },
    [dem, vis, model, azimuth, altitude, zFactor, radius, radiusLimits, t],
  );

  /*
   * The same render, said as the duplicate guard's key (§4.3): what `Behold`
   * compares against the bilder already kept, so scrubbing the azimuth back
   * to a light you have already saved reads `Beholdt` instead of saving it
   * twice.
   *
   * Every field here is one `produce` writes into `meta` — kept adjacent for
   * that reason, because a key that drifts from the record it is matching
   * against silently stops matching anything.
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

  /*
   * "Lagre som ny lokalitet" — the row-1 entrance's one write.
   *
   * It no longer has a second path. Keeping a render into a lokalitet that is
   * already open is `Behold` on the lokalitet row (`localities/behold.ts`),
   * where it is gated on `canAdd` like every other write verb; this used to
   * be the one place a stranger's lokalitet could be written to by accident.
   * So the `locality` guard here is not defensive tidiness — it is the
   * statement that this function only ever creates.
   */
  const save = useCallback(async () => {
    if (locality || !canvasRef.current || !dem || !bbox || saving) return;
    // Signed out is a normal state here — the whole point of Terreng in row 1
    // is that reading the ground needs no account. Only keeping the render
    // does.
    if (!user) {
      openAuthDialog(true);
      return;
    }
    setSaving(true);
    try {
      // The analysed rectangle becomes the lokalitet. Deliberately `bbox` and
      // not the current view — the map is live under the ribbon, so the user
      // has probably panned since pressing Terreng.
      //
      // Before the render rather than after, so the figure's title can carry
      // the name the registers just gave the rectangle.
      const target = await createLocalityFromBbox(
        bbox,
        user.id,
        t('localities.defaultName'),
      );
      if (!target) {
        toast.error({ title: t('localities.createFailed') });
        return;
      }

      const product = await produce(target.name || undefined);
      if (!product) return;

      await createAttachment(
        {
          locality: target.id,
          kind: product.kind,
          caption: product.caption,
          meta: product.meta,
        },
        user.id,
        product.blob,
        product.filename,
      );

      // Opening the new lokalitet is the receipt: the ribbon rescopes to it
      // and the render is sitting in its Bilder. In edit, because you are
      // there to keep a render and the rest of the loop — name it, draw on
      // it, keep another — is all on the far side of that stance (§3).
      setActiveLocality(target);
      setEditingLocalityId(target.id);
      // The starter set follows it in, same as a lokalitet framed from the
      // viewport: this render is one reading of the ground and the three
      // laser readings are the ones you compare it against.
      setPendingStarter(target.id);
    } catch (e) {
      console.warn('[terrain] save failed', e);
      toast.error({ title: t('localities.terrain.saveFailed') });
    } finally {
      setSaving(false);
    }
  }, [
    locality,
    bbox,
    user,
    openAuthDialog,
    setActiveLocality,
    setEditingLocalityId,
    setPendingStarter,
    saving,
    dem,
    produce,
    t,
  ]);

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
  // Before the seed effect on purpose: effects run in declaration order, so
  // on the commit where the lokalitet changes this clears the flag and the
  // one below then seeds from the new record's cover.
  useEffect(() => {
    seededRef.current = false;
  }, [locality?.id]);

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
    hasLocality: locality != null,
    frame,
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
    saving,
    save,
    // What the lokalitet row's `Behold` needs from this tool, and all it
    // needs: how to make the image, and how to tell whether it is already in
    // the Bilder. Published through `beholdOfferAtom`, not props — row 1 and
    // the lokalitet row are siblings.
    produce,
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
