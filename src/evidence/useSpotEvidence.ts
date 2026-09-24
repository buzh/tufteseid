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
import { useMayEditSpot } from '../spots/mayEdit';
import { sunLoopLegend } from './legendContent';
import { keepOffersAtom } from './offer';
import { sortsForMove } from './order';
import {
  enqueueRender,
  jobState,
  renderStates,
  subscribeRenderQueue,
  type RenderState,
} from './queue';
import { evidenceMatches, metaOf, type EvidenceSpec } from './spec';

type KeepOffer = {
  spec: EvidenceSpec;
  /** A row already covers this ground with these parameters, so keeping again
   *  would only make the same picture twice. */
  kept: boolean;
};

export type SpotEvidence = {
  /** Null until the list lands; an empty array means none. */
  items: EvidenceRecord[] | null;
  failed: boolean;
  /** Empty while the spot names no ground: nothing can be rendered. */
  offers: KeepOffer[];
  mayEdit: boolean;
  /** Owner or admin, and the spot has a footprint. */
  mayKeep: boolean;
  keep: (spec: EvidenceSpec) => void;
  retry: (rec: EvidenceRecord) => void;
  remove: (id: string) => void;
  /** Move a row to `to`, an index into `items` as it stands. The reading opens
   *  on the cover (`coverOf`), so this is also how a cover is chosen. */
  reorder: (id: string, to: number) => void;
  /**
   * Where a row stands, by one rule. A row that has pixels has no state at
   * all. Otherwise a job this browser is still holding wins, because it is the
   * only account there is of an ask the sidecar has not marked yet — and past
   * that the sidecar's own `meta.job` outranks whatever the local queue
   * concluded, since it is the side doing the work. A handover that timed out
   * or was refused as a duplicate therefore stops saying so the moment the
   * sidecar says otherwise.
   */
  stateOf: (rec: EvidenceRecord) => RenderState | undefined;
};

const byOrder = (a: EvidenceRecord, b: EvidenceRecord) =>
  a.sort - b.sort || a.created.localeCompare(b.created);

export const useSpotEvidence = (spot: SpotRecord): SpotEvidence => {
  const { i18n } = useTranslation();
  const language = i18n.language;
  const user = useAtomValue(currentUserAtom);
  const mayEdit = useMayEditSpot(spot);
  const offered = useAtomValue(keepOffersAtom);

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

  // No reset for a second spot: the card keying on the record's id is what
  // carries a change of spot, so this hook only ever sees one.
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
  const mayKeep = mayEdit && footprint != null;

  const offers = useMemo(() => {
    if (!footprint || !items) return [];
    const metric = bboxToMetric(footprint);
    return offered.map((spec) => ({
      spec,
      kept: items.some((rec) => evidenceMatches(rec, spec, metric)),
    }));
  }, [offered, items, footprint]);

  const render = useCallback(
    (rec: EvidenceRecord) => {
      if (!footprint) return;
      enqueueRender({
        rec,
        bbox4326: footprint,
        // Composed here and sent with the job, because only a sun loop's band
        // is typeset by the sidecar and only the client knows the reader's
        // language. No centre, which nothing knows before the ground is
        // fetched, and neither the resolution nor the render date: the sidecar
        // substitutes the resolution it achieves, and on a second attempt the
        // stored pair describes the first one.
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

  const reorder = useCallback(
    (id: string, to: number) => {
      if (!items) return;
      const writes = sortsForMove(items, id, to);
      const before = writes
        .map((write) => byId.current.get(write.id))
        .filter((rec) => rec !== undefined);
      if (before.length !== writes.length) return;

      setFailed(false);
      // Written here first: `publish` re-sorts, so the row stays where the hand
      // left it rather than snapping back for the length of the round trip.
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
      // reader could see.
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
    offers,
    mayEdit,
    mayKeep,
    keep,
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
