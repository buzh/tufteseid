// Given an attachment's `meta`, the view that produced it.
//
// This is the primitive behind **Gjenskap** — "put the map back the way it was
// when this image was taken" — and it is deliberately a pure function over a
// record rather than a method on a button, because two later things are
// written on it (docs/lokalitet-view.md §4.2): a View is stored as a spec and
// pinned to a figure PNG afterwards, and a forked lokalitet carries its
// original's views without carrying its files.
//
// The split it encodes is the View/File one. An extract, a terrain render and
// a flyfoto grab are *a row of parameters* — the same parameters over the same
// rectangle give the same picture back, at today's screen resolution rather
// than the resolution it happened to be saved at. A screenshot or an upload is
// only ever bytes: nothing recorded about it is enough to reconstruct it, so
// `viewSpecOf` answers null and the Gjenskap button is **absent**, not
// disabled. There is no view to go back to, which is a different statement
// from "you may not go back to it".
//
// Applying a spec is `useRecreateView`; this module only reads.

import type {
  AttachmentKind,
  AttachmentMeta,
  AttachmentRecord,
} from '../api/attachments';
import { sketchSceneOf, type SketchScene } from '../funn/scene';
import type { LidarModel } from '../map/layers/config/backgroundLayers/lidarProjects';
import { VISUALIZATIONS } from '../shell/terrain/useTerrainAnalysis';
import type { DemModel } from '../terrain/dem';
import { DEFAULT_AZIMUTH } from '../terrain/render';
import type { Visualization } from '../terrain/shade';
import { sceneCompositionOf, type SceneLayer } from './sceneSpec';

export type ViewSpec =
  | {
      kind: 'lidar';
      // 'national' is the 1 m NHM mosaic; a project is matched by name
      // against the WMS catalogue, which is what `meta.sourceKey` stores.
      source: 'national' | { projectName: string };
      style: string;
      model: LidarModel;
    }
  | {
      kind: 'terrain';
      vis: Visualization;
      model: DemModel;
      azimuth: number;
      altitude: number;
      zFactor: number;
      // Absent for the visualizations that have no radius. Stored already
      // clamped to the grid it was rendered on (`clampRadius`), so restoring
      // it over the same rectangle is a round trip; over a coarser one it is
      // clamped again on the way in.
      radius?: number;
    }
  | { kind: 'flyfoto'; source: 'mosaic' | { projectId: string } }
  | {
      kind: 'sketch';
      /*
       * The strokes and the frame they are registered to — `funn/scene.ts`.
       *
       * The odd one out, and worth saying why it belongs in this union at all.
       * The other three specs name an *upstream*: a dataset, an acquisition, a
       * set of knobs, and the pixels come back from a service that may since
       * have changed its mind. A sketch's upstream is the author's own hand and
       * it is stored right here, so re-rendering it is not merely reproducible
       * but exact.
       *
       * What makes it the same kind of thing regardless is the consequence:
       * this is enough to make the picture again, so the record is written
       * without a file and pinned afterwards like any other View, it survives a
       * fork intact (`copyLocality.ts`), and Gjenskap has somewhere to go.
       */
      scene: SketchScene;
    }
  | {
      /*
       * An arrangement of the others (§13.7, `sceneSpec.ts`).
       *
       * A View of Views, and a View by the same test as the rest: which
       * layers were on, in what order, over which ground is enough to make
       * the picture again. What it does *not* hold is the members' own
       * parameters — a member is an attachment id, and the record it names is
       * the spec. So a scene is reproducible exactly as far as its members
       * are, which is the honest depth for something whose whole content is a
       * statement about other records.
       */
      kind: 'scene';
      /** Bottom of the stack, or null for white paper — see `sceneSpec.ts`. */
      ground: GroundSpec | null;
      layers: readonly SceneLayer[];
    };

/** The terrain arm on its own — what §4.6's seeding hands the terrain hook. */
export type TerrainSpec = Extract<ViewSpec, { kind: 'terrain' }>;

/**
 * What may sit under a scene: the three specs that produce *ground*.
 *
 * A sketch is out because it is a transparent layer over the ground rather
 * than an image of it, and a scene is out because a scene of scenes is a
 * recursion nobody asked for. `sceneSpec.ts` enforces the same list on the
 * way in, on the raw `kind`, so this narrowing can never fail at runtime.
 */
export type GroundSpec = Extract<
  ViewSpec,
  { kind: 'lidar' | 'terrain' | 'flyfoto' }
>;

/*
 * Whether this record's pixels exist yet (docs/lokalitet-view.md §4.1.2).
 *
 * A View has three states — spec, pinned, and stale — and only the first two
 * are distinguishable from the record: `file` is empty until the pin queue has
 * rendered and uploaded the figure. An unpinned View is *not* a broken record.
 * It has everything needed to make the image and simply has not been asked to
 * yet, which is why the surfaces say "not fetched yet" rather than showing a
 * failure.
 *
 * A File is pinned from the moment it exists — bytes are the only thing it
 * ever was — so this is true for every screenshot and upload.
 */
export const isPinned = (rec: AttachmentRecord): boolean => rec.file !== '';

const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const isVisualization = (v: unknown): v is Visualization =>
  typeof v === 'string' && (VISUALIZATIONS as string[]).includes(v);

/**
 * The view behind an attachment, or null if it is a File rather than a View.
 *
 * Every field is re-checked rather than trusted: `meta` is a free-form JSON
 * column that has been written by five producers over several schema
 * revisions, and a half-applied view — the right visualization at somebody
 * else's azimuth — is worse than no button, because it looks like it worked.
 *
 * Takes the two columns it reads rather than the whole record, because a
 * scene's ground is a `{kind, meta}` pair that no record was ever written for
 * (§13.7). Every `AttachmentRecord` satisfies it, so no caller had to change.
 */
export const viewSpecOf = (rec: {
  kind: AttachmentKind;
  meta: AttachmentMeta | null;
}): ViewSpec | null => {
  const meta = rec.meta;
  if (!meta) return null;

  if (rec.kind === 'scene') {
    const composition = sceneCompositionOf(meta);
    if (!composition) return null;
    // One level, and only one: `GROUND_KINDS` in `sceneSpec.ts` excludes
    // 'scene', so this call cannot come back here.
    const ground = composition.ground ? viewSpecOf(composition.ground) : null;
    return {
      kind: 'scene',
      ground:
        ground && ground.kind !== 'scene' && ground.kind !== 'sketch'
          ? ground
          : null,
      layers: composition.layers,
    };
  }

  if (rec.kind === 'sketch') {
    const scene = sketchSceneOf(meta);
    return scene ? { kind: 'sketch', scene } : null;
  }

  if (rec.kind === 'flyfoto') {
    const projectId = str(meta.projectId);
    return meta.nibSource === 'project' && projectId
      ? { kind: 'flyfoto', source: { projectId } }
      : { kind: 'flyfoto', source: 'mosaic' };
  }

  if (rec.kind !== 'extract') return null;

  // The two kinds of extract share a `kind` because they share a schema, and
  // `sourceKey` is what tells them apart: a LiDAR extract names the WMS
  // dataset it stitched, a terrain render has no dataset to name — it is
  // computed from a float DEM this app fetched itself.
  const sourceKey = str(meta.sourceKey);
  if (sourceKey) {
    const model: LidarModel = meta.model === 'dom' ? 'dom' : 'dtm';
    const style = str(meta.style) ?? 'skyggerelieff';
    if (sourceKey === 'national') {
      return { kind: 'lidar', source: 'national', style, model };
    }
    const projectName = sourceKey.startsWith('project:')
      ? sourceKey.slice('project:'.length)
      : null;
    return projectName
      ? { kind: 'lidar', source: { projectName }, style, model }
      : null;
  }

  const vis = meta.style;
  if (!isVisualization(vis)) return null;
  const azimuth = num(meta.azimuth);
  const altitude = num(meta.altitude);
  const zFactor = num(meta.zFactor);
  // Azimuth is genuinely absent for the views that have no sun (VAT freezes
  // its own, sky-view and the opennesses have none), so its default is the
  // slider's; altitude and z-factor are written by every terrain save.
  if (altitude == null || zFactor == null) return null;
  const radius = num(meta.radius);
  return {
    kind: 'terrain',
    vis,
    model: meta.model === 'dom' ? 'dom' : 'dtm',
    azimuth: azimuth ?? DEFAULT_AZIMUTH,
    altitude,
    zFactor,
    ...(radius != null ? { radius } : {}),
  };
};
