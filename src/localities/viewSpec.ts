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

import type { AttachmentRecord } from '../api/attachments';
import type { LidarModel } from '../map/layers/config/backgroundLayers/lidarProjects';
import { VISUALIZATIONS } from '../shell/terrain/useTerrainAnalysis';
import type { DemModel } from '../terrain/dem';
import { DEFAULT_AZIMUTH } from '../terrain/render';
import type { Visualization } from '../terrain/shade';

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
  | { kind: 'flyfoto'; source: 'mosaic' | { projectId: string } };

/** The terrain arm on its own — what §4.6's seeding hands the terrain hook. */
export type TerrainSpec = Extract<ViewSpec, { kind: 'terrain' }>;

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
 */
export const viewSpecOf = (rec: AttachmentRecord): ViewSpec | null => {
  const meta = rec.meta;
  if (!meta) return null;

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
