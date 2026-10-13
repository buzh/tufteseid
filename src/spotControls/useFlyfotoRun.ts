

import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';

import { draftGroundAtom, type DraftGround } from '../evidence/draftGround';
import { enqueuePreview, PREVIEW_LANES } from '../evidence/queue';
import type { Produced } from '../evidence/render';
import {
  bboxOfMeta,
  evidenceMatches,
  type EvidenceSpec,
} from '../evidence/spec';
import type { SpotEvidence } from '../evidence/useSpotEvidence';
import { mapAtom } from '../map/atoms';
import { bboxToMetric, bringBboxIntoView, type Bbox } from '../map/bbox';
import { fetchFlyfotoProjectsForBbox } from '../map/layers/config/backgroundLayers/flyfotoProjects';

type FlyfotoSpec = Extract<EvidenceSpec, { kind: 'flyfoto' }>;

export type RunCard = {
  spec: FlyfotoSpec;
  state: 'waiting' | 'rendering' | 'ready' | 'empty' | 'failed';
  produced: Produced | null;

  ground: DraftGround | null;
};

export type RunTally = {

  skipped: number;
  kept: number;
  discarded: number;
};

export type FlyfotoRun = {
  phase: 'off' | 'listing' | 'walking' | 'failed';

  cards: RunCard[];
  tally: RunTally;
  keeping: boolean;
  start: () => void;
  keep: () => void;
  discard: () => void;
  again: () => void;
  finish: () => void;
};

const NO_TALLY: RunTally = { skipped: 0, kept: 0, discarded: 0 };

const revokeAll = (cards: readonly RunCard[]) => {
  for (const card of cards) {
    if (card.ground) URL.revokeObjectURL(card.ground.url);
  }
};

export const useFlyfotoRun = (
  footprint: Bbox | null,
  evidence: SpotEvidence,
): FlyfotoRun => {
  const [phase, setPhase] = useState<FlyfotoRun['phase']>('off');
  const [cards, setCards] = useState<RunCard[]>([]);
  const [tally, setTally] = useState<RunTally>(NO_TALLY);
  const [keeping, setKeeping] = useState(false);
  const map = useAtomValue(mapAtom);
  const setGround = useSetAtom(draftGroundAtom);

  const alive = useRef<AbortController | null>(null);

  const started = useRef(new Set<string>());
  const keepingNow = useRef(false);

  const now = useRef({ cards, footprint, evidence });
  useEffect(() => {
    now.current = { cards, footprint, evidence };
  });

  useEffect(
    () => () => {
      alive.current?.abort();
      revokeAll(now.current.cards);
      setGround(null);
    },
    [setGround],
  );

  const shown = cards[0]?.ground ?? null;
  useEffect(() => {
    setGround(shown);
  }, [shown, setGround]);

  const patch = useCallback(
    (projectId: string, next: Partial<RunCard>) =>
      setCards((prev) =>
        prev.map((card) =>
          card.spec.projectId === projectId ? { ...card, ...next } : card,
        ),
      ),
    [],
  );

  const finish = useCallback(() => {
    alive.current?.abort();
    alive.current = null;
    started.current = new Set();
    revokeAll(now.current.cards);
    setCards([]);
    setTally(NO_TALLY);
    setPhase('off');
  }, []);

  const start = useCallback(() => {
    const { footprint: bbox, evidence: held } = now.current;
    const items = held.items;
    if (!bbox || !items) return;

    finish();
    const ac = new AbortController();
    alive.current = ac;
    setPhase('listing');

    bringBboxIntoView(map, bbox);

    const metric = bboxToMetric(bbox);
    fetchFlyfotoProjectsForBbox(bbox, ac.signal)
      .then((projects) => {
        if (ac.signal.aborted) return;
        const fresh: RunCard[] = [];
        let skipped = 0;
        for (const project of projects) {
          const spec: FlyfotoSpec = {
            kind: 'flyfoto',
            projectId: project.id,
            projectName: project.projectName,
            year: project.year,
            photoDate: project.photoDate,
          };
          if (items.some((rec) => evidenceMatches(rec, spec, metric))) {
            skipped += 1;
            continue;
          }
          fresh.push({ spec, state: 'waiting', produced: null, ground: null });
        }
        setTally({ ...NO_TALLY, skipped });
        setCards(fresh);
        setPhase('walking');
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        console.warn('[flyfoto] acquisition list failed', err);
        setPhase('failed');
      });
  }, [finish, map]);

  useEffect(() => {
    const ac = alive.current;
    const bbox = now.current.footprint;
    if (phase !== 'walking' || !ac || !bbox) return;

    for (const card of cards.slice(0, PREVIEW_LANES + 1)) {
      const projectId = card.spec.projectId;
      if (card.state !== 'waiting' || started.current.has(projectId)) continue;
      started.current.add(projectId);
      patch(projectId, { state: 'rendering' });
      enqueuePreview(card.spec, bbox, ac.signal)
        .then((produced) => {
          if (ac.signal.aborted) return;
          if (!produced) {
            patch(projectId, { state: 'empty' });
            return;
          }

          const extent = bboxOfMeta(produced.meta);
          patch(projectId, {
            state: 'ready',
            produced,
            ground: extent
              ? {
                  id: projectId,
                  url: URL.createObjectURL(produced.blob),
                  extent,
                }
              : null,
          });
        })
        .catch((err) => {
          if (ac.signal.aborted) return;
          console.warn('[flyfoto] preview failed', projectId, err);
          patch(projectId, { state: 'failed' });
        });
    }
  }, [phase, cards, patch]);

  const drop = useCallback(() => {
    const front = now.current.cards[0];

    if (front?.ground) URL.revokeObjectURL(front.ground.url);
    setCards((prev) => prev.slice(1));
  }, []);

  const discard = useCallback(() => {
    if (!now.current.cards[0]) return;
    drop();
    setTally((prev) => ({ ...prev, discarded: prev.discarded + 1 }));
  }, [drop]);

  const keep = useCallback(() => {
    const front = now.current.cards[0];
    const produced = front?.produced;
    if (!front || !produced || keepingNow.current) return;
    keepingNow.current = true;
    setKeeping(true);
    void now.current.evidence
      .keepProduced(front.spec, produced)
      .then((written) => {

        if (written) {
          drop();
          setTally((prev) => ({ ...prev, kept: prev.kept + 1 }));
        }
      })
      .finally(() => {
        keepingNow.current = false;
        setKeeping(false);
      });
  }, [drop]);

  const again = useCallback(() => {
    const front = now.current.cards[0];
    if (!front || (front.state !== 'failed' && front.state !== 'empty')) return;
    started.current.delete(front.spec.projectId);
    patch(front.spec.projectId, { state: 'waiting' });
  }, [patch]);

  return {
    phase,
    cards,
    tally,
    keeping,
    start,
    keep,
    discard,
    again,
    finish,
  };
};
