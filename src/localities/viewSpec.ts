// The View/File split, read off a record's `meta`. A View is a row of
// parameters that gives the same picture back; a File is only ever bytes, so
// `viewSpecOf` answers null. Applying a spec is `useRecreateView`.

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
      // 'national' is the 1 m NHM mosaic; a project is matched by name.
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
      // Absent where the visualization has none; stored already clamped.
      radius?: number;
    }
  | { kind: 'flyfoto'; source: 'mosaic' | { projectId: string } }
  | {
      kind: 'sketch';
      // Unlike the other specs the upstream is stored, not named, so a
      // re-render is exact rather than merely reproducible.
      scene: SketchScene;
    }
  | {
      // Members are attachment ids, not parameters: a scene is reproducible
      // exactly as far as its members are.
      kind: 'scene';
      /** Bottom of the stack, or null for white paper — see `sceneSpec.ts`. */
      ground: GroundSpec | null;
      layers: readonly SceneLayer[];
    };

/** The terrain arm on its own, for seeding the terrain hook. */
export type TerrainSpec = Extract<ViewSpec, { kind: 'terrain' }>;

/** What may sit under a scene: the three specs that produce ground. A sketch
 * is an overlay, and a scene of scenes would recurse. */
export type GroundSpec = Extract<
  ViewSpec,
  { kind: 'lidar' | 'terrain' | 'flyfoto' }
>;

// `file` is empty until the pin queue uploads the figure; an unpinned View is
// not a broken record.
export const isPinned = (rec: AttachmentRecord): boolean => rec.file !== '';

const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const isVisualization = (v: unknown): v is Visualization =>
  typeof v === 'string' && (VISUALIZATIONS as string[]).includes(v);

/**
 * Null if the attachment is a File. Every field is re-checked rather than
 * trusted: `meta` is free-form JSON from five producers over several schema
 * revisions, and a half-applied view looks like it worked. Takes the two
 * columns because a scene's ground has no record behind it.
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
    // One level only: `GROUND_KINDS` excludes 'scene', so this cannot recurse.
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

  // Both kinds of extract share a schema: a LiDAR one names the WMS dataset it
  // stitched, a terrain render has no `sourceKey` at all.
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
  // Azimuth is absent for the views with no sun (VAT freezes its own).
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
