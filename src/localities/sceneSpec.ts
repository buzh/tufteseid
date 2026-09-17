// A scene is an `attachments` row of `kind: 'scene'`: `over` is the membership
// relation (uncascaded, so a deleted member just drops out), `meta` holds the
// order, the per-member fades and the ground under them.

import type { AttachmentKind, AttachmentMeta } from '../api/attachments';
import { type BeholdOffer, flyfotoSpecMeta, lidarSpecMeta } from './behold';

/** `[minX, minY, maxX, maxY]`, EPSG:25833. */
export type Extent25833 = [number, number, number, number];

/** One layer of a scene; `opacity` is percent, 0–100. */
export type SceneLayer = { id: string; opacity: number };

export type SceneGround = { kind: AttachmentKind; meta: AttachmentMeta };

export type SceneComposition = {
  ground: SceneGround | null;
  /** Bottom-to-top. */
  layers: SceneLayer[];
};

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null;

// Must stay a closed list excluding 'scene': it is what stops the reader below
// recursing into a scene-in-a-scene however the JSON was written.
const GROUND_KINDS: readonly AttachmentKind[] = ['extract', 'flyfoto'];

/** A scene's `meta`, re-checked field by field, or null if this is not one. */
export const sceneCompositionOf = (
  meta: AttachmentMeta | null,
): SceneComposition | null => {
  if (!meta) return null;
  const raw = meta.layers;
  if (!Array.isArray(raw)) return null;

  const layers: SceneLayer[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const id = str((entry as Record<string, unknown>).id);
    if (!id) continue;
    const opacity = num((entry as Record<string, unknown>).opacity);
    layers.push({
      id,
      // A fade nobody wrote is full strength.
      opacity: opacity == null ? 100 : Math.min(100, Math.max(0, opacity)),
    });
  }

  const g = meta.ground as Record<string, unknown> | null | undefined;
  const kind = g ? str(g.kind) : null;
  const groundMeta = g?.meta;
  const ground =
    kind && GROUND_KINDS.includes(kind as AttachmentKind) && groundMeta
      ? {
          kind: kind as AttachmentKind,
          meta: groundMeta as AttachmentMeta,
        }
      : null;

  // An arrangement of nothing over nothing is not one; the queue would pin a
  // blank sheet with a caption.
  if (!ground && layers.length === 0) return null;
  return { ground, layers };
};

// A spec records the rectangle it is about: the pin queue renders that one,
// not the lokalitet's current bbox.
export const sceneMetaOf = ({
  bbox25833,
  ground,
  layers,
}: {
  bbox25833: Extent25833;
  ground: SceneGround | null;
  layers: readonly SceneLayer[];
}): AttachmentMeta => ({
  bbox25833,
  ground,
  layers: layers.map((l) => ({ id: l.id, opacity: l.opacity })),
});

// Goes through `Behold`'s own meta builders: a scene's ground and a kept
// ground must be the same row of parameters.
export const sceneGroundOf = (
  offer: BeholdOffer | null,
  bbox25833: Extent25833,
): SceneGround | null => {
  if (!offer) return null;
  switch (offer.ground) {
    case 'lidar':
      return offer.source
        ? {
            kind: 'extract',
            meta: lidarSpecMeta(offer.source, offer.style, bbox25833),
          }
        : null;
    case 'flyfoto':
      return {
        kind: 'flyfoto',
        meta: flyfotoSpecMeta(offer.project ?? undefined, bbox25833),
      };
    case 'terreng': {
      const spec = offer.describe();
      return spec ? { kind: spec.kind, meta: spec.meta } : null;
    }
    // Standard and Hybrid: no rectangle-fetch path for the topo WMS.
    default:
      return null;
  }
};

// Mirrors on `meta.layers` the id translation `useLocalityDraft` and
// `copyLocality` do to `over`; untranslatable ids are dropped, not carried.
export const remapSceneMeta = (
  meta: AttachmentMeta,
  translate: (id: string) => string | null,
): AttachmentMeta => {
  const composition = sceneCompositionOf(meta);
  if (!composition) return meta;
  const layers: SceneLayer[] = [];
  for (const layer of composition.layers) {
    const id = translate(layer.id);
    if (id) layers.push({ id, opacity: layer.opacity });
  }
  return { ...meta, layers };
};
