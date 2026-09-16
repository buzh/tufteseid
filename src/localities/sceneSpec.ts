/*
 * A scene: the arrangement itself, kept as a record (docs/lokalitet-view.md
 * §13.7, §13.10 step 8).
 *
 * The layer row lets you build a composition — a 1937 ortofoto at 40 % over a
 * sky-view render, a sketch on top of both — and until this step the only way
 * to keep one was `Ta skjermbilde`, which flattens it to a File and throws
 * away every component and every parameter. A scene is the same composition
 * stored as *what it is made of*, so it can be put back on the map, re-read at
 * a different zoom, forked with the lokalitet, and pinned to a figure whose
 * caption lists its layers.
 *
 * ## Where it lives
 *
 * In `attachments`, as `kind: 'scene'`, which is what makes it inherit `sort`,
 * `hidden`, `caption`, the copy's translation and the pin queue for free. Two
 * fields carry it and both already existed (1700000800 adds no column):
 *
 * - **`over`** — membership. The multiple relation a sketch uses to say which
 *   bilder it is a layer on, uncascaded, already remapped by `copyLocality`.
 *   It is what the *database* knows about the scene's contents.
 * - **`meta`** — the order, the per-member fade, and the ground under them.
 *
 * The two say the same set of ids and neither is derivable from the other:
 * `over` cannot hold an order or a number, and a relation is the only way the
 * membership survives as something more than free-form JSON. Readers take the
 * order and the fades from `meta` and treat `over` as the set — a scene whose
 * member has since been deleted simply has one fewer layer, which is the
 * behaviour the uncascaded relation was chosen for.
 *
 * ## What a member is
 *
 * An attachment id, and nothing else — no copy of the member's spec. §13.2's
 * rule is what makes that safe: a member is a spec or a File, never "this
 * View, but as its pixels", so the member record is the whole answer to what
 * to draw. Re-render the scene in a year and a re-flown LiDAR project changes
 * what its bottom layer looks like, exactly as it would for the member on its
 * own — which is why the pinned flatten, like every other pin, is the citable
 * artifact and not a cache (`pinQueue.ts`).
 *
 * The ground preset is the one member that is not a record: "Flyfoto" is the
 * live ortofoto ground, not an attachment. So it is stored as the same
 * `{kind, meta}` pair a `Behold` of that ground would have written, which
 * `viewSpecOf` reads back with no special case. Standard and Hybrid write no
 * ground at all, for the reason `behold.ts` refuses to keep them: there is no
 * rectangle-fetch path for the topo WMS. A scene built over one of those
 * flattens onto white paper, like a sketch's figure does.
 */

import type { AttachmentKind, AttachmentMeta } from '../api/attachments';
import { type BeholdOffer, flyfotoSpecMeta, lidarSpecMeta } from './behold';

/** `[minX, minY, maxX, maxY]`, EPSG:25833 — as every stored spec writes it. */
export type Extent25833 = [number, number, number, number];

/**
 * One layer of a scene.
 *
 * `opacity` is **percent**, 0–100, because that is the number the control
 * holds and the caption prints; the 0–1 conversion happens at the canvas
 * boundary, in the same direction `setSketchOverlays` and the two ground
 * controls already make it.
 */
export type SceneLayer = { id: string; opacity: number };

/** The ground preset under the members, said as a keepable spec. */
export type SceneGround = { kind: AttachmentKind; meta: AttachmentMeta };

/** A scene's `meta`, read back and checked. */
export type SceneComposition = {
  ground: SceneGround | null;
  /** Bottom-to-top, like the row itself reads left-to-right. */
  layers: SceneLayer[];
};

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null;

/*
 * Which kinds may be a scene's ground.
 *
 * A closed list rather than "anything `viewSpecOf` answers for", and that is
 * what keeps a scene from ever containing a scene: `kind: 'scene'` is not in
 * it, so the reader below cannot recurse however the JSON was written. A
 * sketch is out for the other reason — the ground is the bottom of the stack
 * and a sketch is a transparent layer over it, which is a member.
 */
const GROUND_KINDS: readonly AttachmentKind[] = ['extract', 'flyfoto'];

/**
 * A scene's `meta`, or null if this is not one.
 *
 * Every field is re-checked, for the reason `viewSpecOf` gives about `meta`
 * generally: it is a free-form JSON column, and a half-read arrangement — the
 * right layers in the wrong order — is worse than no scene, because it looks
 * like it worked.
 */
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
      // A fade nobody wrote is full strength, which is also what every
      // surface in the row assumes for a member it has no entry for.
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

  // An arrangement of nothing over nothing is not one. Without this a scene
  // could be kept over Standard with every group switched off, and what the
  // queue would pin is a blank sheet with a caption.
  if (!ground && layers.length === 0) return null;
  return { ground, layers };
};

/**
 * …and the other direction: what `Oppsett` on the lokalitet row writes.
 *
 * `bbox25833` goes in beside them because every stored spec records the
 * rectangle it is about — the pin queue renders *that* one rather than the
 * lokalitet's current one (`rectangleOf`), so a scene kept before "Juster
 * området" moved the rectangle still flattens the ground it was built over.
 */
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

/**
 * The ground on screen as a scene's bottom layer, or null where there is none.
 *
 * The same three answers `Behold` gives, from the same offer and through the
 * same meta builders — a scene's ground and a kept ground have to be the same
 * row of parameters, or the bottom of a flatten would stop matching the
 * extract beside it in the rail. Terrain says what it is showing through its
 * own `describe()`, being the one ground whose parameters are not recoverable
 * from a dataset name.
 */
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
    // Standard and Hybrid. Not a gap — see the header.
    default:
      return null;
  }
};

/**
 * A scene's `meta` with its member ids translated — for the two places that
 * mint new ids for records a scene already points at.
 *
 * The edit transaction is one (`useLocalityDraft`): a scene kept in the same
 * session as the extract under it names that extract by its `draft:` id, and
 * the commit only knows how to remap the *relation*. The copy is the other
 * (`copyLocality`): every id in a fork means nothing in the original's
 * lokalitet. Both already do exactly this to `over`; this is the same move on
 * the half of the answer that lives in JSON.
 *
 * Anything untranslatable is dropped rather than carried, which is the same
 * choice `resolve` makes for the relation: a layer pointing at a record that
 * was never written is not a layer, and leaving the id in would put a hole in
 * the flatten that no surface could explain.
 */
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
