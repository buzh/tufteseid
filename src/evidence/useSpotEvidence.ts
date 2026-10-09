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
import { bboxToMetric } from '../map/bbox';
import { sunLoopLegend } from './legendContent';
import { keepOfferAtom } from './offer';
import { sortsForMove } from './order';
import {
  enqueueRender,
  jobState,
  renderStates,
  subscribeRenderQueue,
  type RenderState,
} from './queue';
import type { Produced } from './render';
import { evidenceMatches, metaOf, type EvidenceSpec } from './spec';

type KeepOffer = {
  spec: EvidenceSpec;
  /** A row already covers this ground with these parameters. */
  kept: boolean;
};

export type SpotEvidence = {
  /** Null until the list lands; an empty array means none. */
  items: EvidenceRecord[] | null;
  failed: boolean;
  /** The view as it stands, or null where nothing on screen can be re-rendered. */
  offer: KeepOffer | null;
  keep: (spec: EvidenceSpec) => void;
  /** A row written from pixels already made, for a picker that renders before it
   *  asks. False where nothing was written and the reader can press again. */
  keepProduced: (spec: EvidenceSpec, produced: Produced) => Promise<boolean>;
  retry: (rec: EvidenceRecord) => void;
  remove: (id: string) => void;
  /** Move a row to index `to`. The reading opens on the cover (`coverOf`), so
   *  this also chooses a cover. */
  reorder: (id: string, to: number) => void;
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

  const metric = useMemo(
    () => (footprint ? bboxToMetric(footprint) : null),
    [footprint],
  );

  const offer = useMemo(
    () =>
      metric && items && offered
        ? {
            spec: offered,
            kept: items.some((rec) => evidenceMatches(rec, offered, metric)),
          }
        : null,
    [offered, items, metric],
  );

  const render = useCallback(
    (rec: EvidenceRecord) => {
      if (!footprint) return;
      enqueueRender({
        rec,
        bbox4326: footprint,
        // Composed here: only the client knows the reader's language, and only a
        // sun loop's band is typeset by the sidecar.
        legend:
          rec.kind === 'sunloop' ? sunLoopLegend(rec, spot, language) : null,
        onDone: upsert,
      });
    },
    [footprint, spot, language, upsert],
  );

  const keep = useCallback(
    (spec: EvidenceSpec) => {
      if (!user || !footprint) return;
      setFailed(false);
      createEvidence(
        { spot: spotId, kind: spec.kind, meta: metaOf(spec) },
        user.id,
      )
        .then((rec) => {
          upsert(rec);
          render(rec);
        })
        .catch((err) => {
          console.warn(
            '[evidence] keep failed',
            err,
            (err as { response?: { data?: unknown } })?.response?.data,
          );
          setFailed(true);
        });
    },
    [user, footprint, spotId, upsert, render],
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
        if (created) {
          const id = created.id;
          byId.current.delete(id);
          publish();
          deleteEvidence(id).catch(() => {});
        }
        setFailed(true);
        return false;
      }
    },
    [user, footprint, spotId, upsert, publish],
  );

  const reorder = useCallback(
    (id: string, to: number) => {
      if (!items) return;
      const writes = sortsForMove(items, id, to);
      const before = writes
        .map((write) => byId.current.get(write.id))
        .filter((rec) => rec !== undefined);
      if (before.length !== writes.length) return;

      setFailed(false);
      // Written first so the row stays where the hand left it, not snapping back
      // for the round trip.
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
    retry: render,
    remove,
    reorder,
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
