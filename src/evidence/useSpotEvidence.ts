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
import { groupEvidence } from './groups';
import { sunLoopLegend } from './legendContent';
import { keepOfferAtom } from './offer';
import { evenSorts, groupMoveSorts, moved } from './order';
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
  keepIdOf,
  metaOf,
  newKeepId,
  type EvidenceSpec,
} from './spec';

type KeepOffer = {
  spec: EvidenceSpec;
  kept: boolean;
};

export type SpotEvidence = {
  items: EvidenceRecord[] | null;
  failed: boolean;
  offer: KeepOffer | null;
  keep: (spec: EvidenceSpec) => void;
  keepProduced: (spec: EvidenceSpec, produced: Produced) => Promise<boolean>;
  retry: (rec: EvidenceRecord) => void;
  remove: (id: string) => void;
  reorderGroup: (key: string, to: number) => void;
  stateOf: (rec: EvidenceRecord) => RenderState | undefined;
  covered: (rec: EvidenceRecord) => boolean;
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

  const stateOf = useCallback(
    (rec: EvidenceRecord) => {
      if (rec.file) return undefined;
      const local = states.get(rec.id);
      if (local === 'queued' || local === 'running') return local;
      return jobState(rec) ?? local;
    },
    [states],
  );

  const covered = useCallback(
    (rec: EvidenceRecord) => {
      if (rec.file) return true;
      const state = stateOf(rec);
      return state === 'queued' || state === 'running';
    },
    [stateOf],
  );

  const footprint = spot.footprint;

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
            kept: metrics.every((m) =>
              items.some(
                (rec) => covered(rec) && evidenceMatches(rec, offered, m),
              ),
            ),
          }
        : null,
    [offered, items, metrics, covered],
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
      const standing = metrics.map(
        (m) => items?.find((rec) => evidenceMatches(rec, spec, m)) ?? null,
      );
      const keepId =
        standing.map((rec) => rec && keepIdOf(rec)).find(Boolean) ??
        newKeepId();

      tiles.forEach((tile, i) => {
        const already = standing[i];
        if (already) {
          if (!covered(already)) render(already, tile);
          return;
        }
        createEvidence(
          {
            spot: spotId,
            kind: spec.kind,
            meta: { ...metaOf(spec), bbox25833: metrics[i], keep: keepId },
          },
          user.id,
        )
          .then((rec) => {
            upsert(rec);
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
    [user, tiles, metrics, items, spotId, upsert, render, discard, covered],
  );

  const keepProduced = useCallback(
    async (spec: EvidenceSpec, produced: Produced) => {
      if (!user || !footprint) return false;
      setFailed(false);
      let created: EvidenceRecord | null = null;
      const keep = newKeepId();
      try {
        created = await createEvidence(
          { spot: spotId, kind: spec.kind, meta: { ...metaOf(spec), keep } },
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
              keep,
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
        if (created) discard(created.id);
        setFailed(true);
        return false;
      }
    },
    [user, footprint, spotId, upsert, discard],
  );

  const retry = useCallback(
    (rec: EvidenceRecord) => {
      const box = evidenceBbox(rec);
      const bbox4326 = box ? bboxFromMetric(box) : footprint;
      if (bbox4326) render(rec, bbox4326);
    },
    [render, footprint],
  );

  const reorderGroup = useCallback(
    (key: string, to: number) => {
      if (!items) return;
      const groups = groupEvidence(items);
      const from = groups.findIndex((group) => group.key === key);
      if (from < 0 || from === to) return;
      const writes =
        groupMoveSorts(groups, from, to) ??
        evenSorts(moved(groups, from, to).flatMap((group) => group.rows));
      const before = writes
        .map((write) => byId.current.get(write.id))
        .filter((rec): rec is EvidenceRecord => rec !== undefined);
      if (before.length !== writes.length) return;

      setFailed(false);
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
    stateOf,
    covered,
  };
};
