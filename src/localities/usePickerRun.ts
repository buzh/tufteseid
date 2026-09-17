import i18n from 'i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttachmentKind, AttachmentMeta } from '../api/attachments';
import type { LocalityBbox, LocalityRecord } from '../api/localities';
import { stampBlob } from '../figure/figure';
import { figureSpecOf, stampContextOf } from '../figure/fromRecord';
import { saveBlob } from '../shared/utils/download';
import type { BeholdKey } from './behold';
import { type Produced, renderSpec } from './pinQueue';
import type { ViewSpec } from './viewSpec';

/*
 * A picker run: N proposals, each kept or discarded; a discarded one was never
 * a record. Producing is a tile burst against a shared public edge, so the run
 * fetches sequentially and only ever aims at the card under the cursor and the
 * one after it. Keeping writes the bytes the card is already showing.
 */

export type PickerSource = 'lidar' | 'flyfoto';

export type PickerCandidate = {
  id: string;
  title: string;
  subtitle: string | null;
  kind: AttachmentKind;
  caption: string;
  /** The spec as it would be written; `renderSpec` reads it back out. */
  meta: AttachmentMeta;
  spec: ViewSpec;
  /** Checked against the collection once, before the run starts. */
  key: BeholdKey;
};

export type PickerCardState =
  'waiting' | 'fetching' | 'ready' | 'empty' | 'failed' | 'kept';

export type PickerCard = {
  candidate: PickerCandidate;
  state: PickerCardState;
  produced: Produced | null;
  url: string | null;
};

export type PickerRun = {
  source: PickerSource;
  cards: PickerCard[];
  /** Index into `cards`. Discarding removes a card, so this is not an id. */
  at: number;
  /** What the dialog handed over, before the duplicate filter. */
  total: number;
  kept: number;
  discarded: number;
  /** Already in the collection, so never proposed. */
  skipped: number;
};

type Options = {
  /** Whose lokalitet this is, for the plate a downloaded proposal carries. */
  locality: LocalityRecord;
  bbox4326: LocalityBbox;
  isDuplicate: (key: BeholdKey) => boolean;
  /** Writes the record; `false` leaves the card keepable. */
  onKeep: (candidate: PickerCandidate, produced: Produced) => Promise<boolean>;
};

const revokeAll = (run: PickerRun | null) => {
  if (!run) return;
  for (const card of run.cards) if (card.url) URL.revokeObjectURL(card.url);
};

export const usePickerRun = ({
  locality,
  bbox4326,
  isDuplicate,
  onKeep,
}: Options) => {
  const [run, setRun] = useState<PickerRun | null>(null);
  const [keeping, setKeeping] = useState(false);

  // Bumped whenever a run ends. `renderSpec` takes no AbortSignal, so Esc stops
  // starting fetches and drops the one in flight; it ends on its own deadline.
  const generation = useRef(0);
  // The generation the in-flight fetch belongs to, so a new run starts at once.
  const fetchingGen = useRef<number | null>(null);
  const keepingRef = useRef(false);
  // The callbacks below must not be re-created every time a card changes state.
  const runRef = useRef(run);
  runRef.current = run;
  const opts = useRef({ locality, bbox4326, isDuplicate, onKeep });
  opts.current = { locality, bbox4326, isDuplicate, onKeep };

  const patch = useCallback(
    (id: string, next: Partial<PickerCard>) =>
      setRun((prev) =>
        prev
          ? {
              ...prev,
              cards: prev.cards.map((c) =>
                c.candidate.id === id ? { ...c, ...next } : c,
              ),
            }
          : prev,
      ),
    [],
  );

  // One fetch at a time, at the cursor then one ahead; finishing re-arms it.
  useEffect(() => {
    if (!run) return;
    if (fetchingGen.current === generation.current) return;
    const next = [run.cards[run.at], run.cards[run.at + 1]].find(
      (c) => c?.state === 'waiting',
    );
    if (!next) return;

    const { candidate } = next;
    const gen = generation.current;
    fetchingGen.current = gen;
    patch(candidate.id, { state: 'fetching' });

    renderSpec(candidate.spec, opts.current.bbox4326)
      .then((produced) => {
        if (gen !== generation.current) return;
        if (!produced) {
          patch(candidate.id, { state: 'empty' });
          return;
        }
        patch(candidate.id, {
          state: 'ready',
          produced,
          url: URL.createObjectURL(produced.blob),
        });
      })
      .catch((e: unknown) => {
        console.warn('[picker] render failed', candidate.id, e);
        if (gen !== generation.current) return;
        patch(candidate.id, { state: 'failed' });
      })
      .finally(() => {
        if (fetchingGen.current === gen) fetchingGen.current = null;
      });
  }, [run, patch]);

  useEffect(() => () => revokeAll(runRef.current), []);

  /** Takes the bottom slot, ending whatever run was there. */
  const start = useCallback(
    (source: PickerSource, candidates: PickerCandidate[]) => {
      generation.current += 1;
      revokeAll(runRef.current);
      // Before the tile burst: a duplicate is the one request to avoid.
      const fresh = candidates.filter((c) => !opts.current.isDuplicate(c.key));
      setRun({
        source,
        cards: fresh.map((candidate) => ({
          candidate,
          state: 'waiting' as const,
          produced: null,
          url: null,
        })),
        at: 0,
        total: candidates.length,
        kept: 0,
        discarded: 0,
        skipped: candidates.length - fresh.length,
      });
    },
    [],
  );

  /** `Ferdig` and `Esc`: cancels whatever has not been fetched. */
  const finish = useCallback(() => {
    generation.current += 1;
    revokeAll(runRef.current);
    setRun(null);
  }, []);

  const goTo = useCallback((index: number) => {
    setRun((prev) => {
      if (!prev || prev.cards.length === 0) return prev;
      const at = Math.min(Math.max(index, 0), prev.cards.length - 1);
      return at === prev.at ? prev : { ...prev, at };
    });
  }, []);

  const step = useCallback(
    (delta: 1 | -1) => {
      const prev = runRef.current;
      if (prev) goTo(prev.at + delta);
    },
    [goTo],
  );

  /** The card leaves the rail rather than greying out. */
  const discard = useCallback(() => {
    const prev = runRef.current;
    if (!prev) return;
    const card = prev.cards[prev.at];
    if (!card || card.state === 'kept') return;
    if (card.url) URL.revokeObjectURL(card.url);
    const cards = prev.cards.filter((_, i) => i !== prev.at);
    setRun({
      ...prev,
      cards,
      at: Math.min(prev.at, Math.max(cards.length - 1, 0)),
      discarded: prev.discarded + 1,
    });
  }, []);

  /** Writes now, with the bytes on screen, so Esc only ever cancels fetching. */
  const keep = useCallback(async () => {
    const prev = runRef.current;
    if (!prev || keepingRef.current) return;
    const card = prev.cards[prev.at];
    if (!card || card.state !== 'ready' || !card.produced) return;
    keepingRef.current = true;
    setKeeping(true);
    try {
      const ok = await opts.current.onKeep(card.candidate, card.produced);
      if (!ok) return;
      setRun((cur) =>
        cur
          ? {
              ...cur,
              cards: cur.cards.map((c) =>
                c.candidate.id === card.candidate.id
                  ? { ...c, state: 'kept' as const }
                  : c,
              ),
              kept: cur.kept + 1,
            }
          : cur,
      );
      step(1);
    } finally {
      keepingRef.current = false;
      setKeeping(false);
    }
  }, [step]);

  /**
   * The proposal on disk without joining the collection — the run is the only
   * place these pixels exist. Stamped here rather than handed out as the object
   * URL the card is showing: the thumbnail is a preview, the file is a
   * publication. The spec is built from the two halves the keep would have
   * written, so this file and the kept one's download are the same file.
   */
  const download = useCallback(async () => {
    const prev = runRef.current;
    const card = prev?.cards[prev.at];
    if (!card?.produced) return;
    const spec = figureSpecOf(
      {
        kind: card.candidate.kind,
        meta: { ...card.candidate.meta, ...card.produced.meta },
      },
      stampContextOf(opts.current.locality, i18n.language),
    );
    saveBlob(await stampBlob(card.produced.blob, spec), card.produced.filename);
  }, []);

  return {
    run,
    active: run ? (run.cards[run.at] ?? null) : null,
    keeping,
    start,
    finish,
    goTo,
    step,
    keep,
    discard,
    download,
  };
};

export type PickerApi = ReturnType<typeof usePickerRun>;
