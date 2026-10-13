import { useAtomValue } from 'jotai';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
  attachEvidenceFile,
  createEvidence,
  deleteEvidence,
  listSpotEvidence,
  setEvidenceSort,
  subscribeEvidence,
  type EvidenceRecord,
} from '../api/evidence';
import type { SpotRecord } from '../api/spots';
import { currentUserAtom } from '../auth/atoms';
import { bboxFromMetric, bboxToMetric, type Bbox } from '../map/bbox';
import { mosaicTiles } from '../map/grid';
import { sunLoopLegend } from './legendContent';
import { keepOfferAtom } from './offer';
import { groupEvidence } from './groups';
import { evenSorts, moved } from './order';
import {
  enqueueRender,
  jobState,
  renderStates,
  subscribeRenderQueue,
  type RenderState,
} from './queue';
import type { Produced } from './render';
import {
  evidenceBbox,
  evidenceMatches,
  metaOf,
  type EvidenceSpec,
} from './spec';

type KeepOffer = {
  spec: EvidenceSpec;
  /** A row already covers this ground with these parameters. */
  kept: boolean;
};

export type SpotEvidence = {
  /** Null until the list lands; an empty array means none. */
  items: EvidenceRecord[] | null;
  failed: boolean;
  /** The view as it stands, or null where nothing on screen can be
   *  re-rendered. */
  offer: KeepOffer | null;
  keep: (spec: EvidenceSpec) => void;
  /** A row written from pixels already made, for a picker that renders before
   *  it asks. False where nothing was written and the reader can press
   *  again. */
  keepProduced: (spec: EvidenceSpec, produced: Produced) => Promise<boolean>;
  retry: (rec: EvidenceRecord) => void;
  remove: (id: string) => void;
  /** Move a group (a mosaic's tiles, or a lone row) to group index `to`. The
   *  reading opens on the cover (`coverOf`), so this also chooses a cover. */
  reorderGroup: (key: string, to: number) => void;
  /** A row with pixels has no state; otherwise a job this browser still holds
   *  wins, and past that the sidecar's `meta.job` outranks the local queue. */
  stateOf: (rec: EvidenceRecord) => RenderState | undefined;
};

const byOrder = (a: EvidenceRecord, b: EvidenceRecord) =>
  a.sort - b.sort || a.created.localeCompare(b.created);

export const useSpotEvidence = (spot: SpotRecord): SpotEvidence => {
  const { i18n } = useTranslation();
  const language = i18n.language;
  const user = useAtomValue(currentUserAtom);
  const offered = useAtomValue(keepOfferAtom);

  const [items, setItems] = useState<EvidenceRecord[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Shared by the fetch, the realtime feed and a finished render, all of which
  // land out of order.
  const byId = useRef(new Map<string, EvidenceRecord>());

  const publish = useCallback(
    () => setItems([...byId.current.values()].sort(byOrder)),
    [],
  );

  const upsert = useCallback(
    (rec: EvidenceRecord) => {
      byId.current.set(rec.id, rec);
      publish();
    },
    [publish],
  );

  // No reset for a second spot: the card keys on the record's id, so this hook
  // only ever sees one.
  const spotId = spot.id;
  useEffect(() => {
    let live = true;
    listSpotEvidence(spotId)
      .then((list) => {
        if (!live) return;
        for (const rec of list) byId.current.set(rec.id, rec);
        publish();
      })
      .catch((err) => {
        if (!live) return;
        console.warn('[evidence] list failed', err);
        setFailed(true);
      });

    // The feed is per collection, so rows belonging to another spot arrive too.
    const unsubscribe = subscribeEvidence((action, rec) => {
      if (!live || rec.spot !== spotId) return;
      if (action === 'delete') byId.current.delete(rec.id);
      else byId.current.set(rec.id, rec);
      publish();
    });

    return () => {
      live = false;
      unsubscribe();
    };
  }, [spotId, publish]);

  const states = useSyncExternalStore(subscribeRenderQueue, renderStates);

  const footprint = spot.footprint;

  // The render boxes the boundary covers: one free box within the cap, a grid
  // of tiles past it (`src/map/grid.ts`). Every keep fans out across them.
  const tiles = useMemo(
    () => (footprint ? mosaicTiles(footprint) : []),
    [footprint],
  );
  const metrics = useMemo(() => tiles.map(bboxToMetric), [tiles]);

  const offer = useMemo(
    () =>
      metrics.length > 0 && items && offered
        ? {
            spec: offered,
            // Kept only once every tile is covered; a half-filled mosaic still
            // offers the keep that completes it.
            kept: metrics.every((m) =>
              items.some((rec) => evidenceMatches(rec, offered, m)),
            ),
          }
        : null,
    [offered, items, metrics],
  );

  const discard = useCallback(
    (id: string) => {
      byId.current.delete(id);
      publish();
      deleteEvidence(id).catch(() => {});
    },
    [publish],
  );

  const render = useCallback(
    (rec: EvidenceRecord, bbox4326: Bbox, onRefused?: () => void) => {
      enqueueRender({
        rec,
        onRefused,
        bbox4326,
        // Composed here: only the client knows the reader's language, and only
        // a sun loop's band is typeset by the sidecar.
        legend:
          rec.kind === 'sunloop' ? sunLoopLegend(rec, spot, language) : null,
        onDone: upsert,
      });
    },
    [spot, language, upsert],
  );

  const keep = useCallback(
    (spec: EvidenceSpec) => {
      if (!user || tiles.length === 0) return;
      setFailed(false);
      tiles.forEach((tile, i) => {
        const metric = metrics[i];
        // Only the tiles not yet covered: re-keeping fills the gaps a failed or
        // interrupted mosaic left rather than doubling the ones that landed.
        if (items?.some((rec) => evidenceMatches(rec, spec, metric))) return;
        createEvidence(
          // The tile's box is stamped up front so the kept check and a retry
          // both know which tile this row is, before any pixels land. The
          // render overwrites it with the box it achieved, the same tile
          // within `BBOX_TOLERANCE_M`.
          {
            spot: spotId,
            kind: spec.kind,
            meta: { ...metaOf(spec), bbox25833: metric },
          },
          user.id,
        )
          .then((rec) => {
            upsert(rec);
            // A refused handover leaves no `meta.job`, and a row with neither
            // pixels nor job reads as a render still on its way for as long as
            // it stands — jamming every order chip behind it. Nothing was kept,
            // so the row goes with it.
            render(rec, tile, () => {
              discard(rec.id);
              setFailed(true);
            });
          })
          .catch((err) => {
            console.warn(
              '[evidence] keep failed',
              err,
              (err as { response?: { data?: unknown } })?.response?.data,
            );
            setFailed(true);
          });
      });
    },
    [user, tiles, metrics, items, spotId, upsert, render, discard],
  );

  const keepProduced = useCallback(
    async (spec: EvidenceSpec, produced: Produced) => {
      if (!user || !footprint) return false;
      setFailed(false);
      let created: EvidenceRecord | null = null;
      try {
        created = await createEvidence(
          { spot: spotId, kind: spec.kind, meta: metaOf(spec) },
          user.id,
        );
        upsert(created);
        upsert(
          await attachEvidenceFile(
            created.id,
            produced.blob,
            produced.filename,
            {
              ...metaOf(spec),
              ...produced.meta,
              renderedAt: new Date().toISOString(),
            },
          ),
        );
        return true;
      } catch (err) {
        console.warn(
          '[evidence] keep failed',
          err,
          (err as { response?: { data?: unknown } })?.response?.data,
        );
        // A row whose file never landed has nothing to retry — the pixels were
        // the run's, and the run still holds them.
        if (created) discard(created.id);
        setFailed(true);
        return false;
      }
    },
    [user, footprint, spotId, upsert, discard],
  );

  // Over the row's own tile, not the spot's boundary: a mosaic row remembers
  // which tile it is in `meta.bbox25833`. Legacy single-box rows with no stamp
  // fall back to the footprint, which is their tile.
  const retry = useCallback(
    (rec: EvidenceRecord) => {
      const box = evidenceBbox(rec);
      const bbox4326 = box ? bboxFromMetric(box) : footprint;
      if (bbox4326) render(rec, bbox4326);
    },
    [render, footprint],
  );

  // A whole mosaic moves as a block: its tiles stay contiguous and in order, so
  // the list renumbers rather than slipping one row between two neighbours.
  const reorderGroup = useCallback(
    (key: string, to: number) => {
      if (!items) return;
      const groups = groupEvidence(items);
      const from = groups.findIndex((group) => group.key === key);
      if (from < 0 || from === to) return;
      const flat = moved(groups, from, to).flatMap((group) => group.rows);
      const writes = evenSorts(flat);
      const before = writes
        .map((write) => byId.current.get(write.id))
        .filter((rec): rec is EvidenceRecord => rec !== undefined);
      if (before.length !== writes.length) return;

      setFailed(false);
      // Written first so the rows stay where the hand left them, not snapping
      // back for the round trip.
      writes.forEach((write, i) => upsert({ ...before[i], sort: write.sort }));
      Promise.all(
        writes.map((write) => setEvidenceSort(write.id, write.sort)),
      ).catch((err) => {
        console.warn('[evidence] reorder failed', err);
        before.forEach((rec) => upsert(rec));
        setFailed(true);
      });
    },
    [items, upsert],
  );

  const remove = useCallback(
    (id: string) => {
      const was = byId.current.get(id);
      if (!was) return;
      setFailed(false);
      // Dropped first: the realtime delete may never arrive for a row only this
      // reader can see.
      byId.current.delete(id);
      publish();
      deleteEvidence(id).catch((err) => {
        console.warn('[evidence] delete failed', err);
        upsert(was);
        setFailed(true);
      });
    },
    [publish, upsert],
  );

  return {
    items,
    failed,
    offer,
    keep,
    keepProduced,
    retry,
    remove,
    reorderGroup,
    stateOf: useCallback(
      (rec: EvidenceRecord) => {
        if (rec.file) return undefined;
        const local = states.get(rec.id);
        if (local === 'queued' || local === 'running') return local;
        return jobState(rec) ?? local;
      },
      [states],
    ),
  };
};
