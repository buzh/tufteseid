import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttachmentKind, AttachmentMeta } from '../api/attachments';
import type { LocalityBbox } from '../api/localities';
import type { BeholdKey } from './behold';
import { type Produced, renderSpec } from './pinQueue';
import type { ViewSpec } from './viewSpec';

/*
 * A picker run: N proposals, fetched one ahead of you, each one kept or
 * discarded (docs/lokalitet-view.md §4.3).
 *
 * `LiDAR-uttrekk` and `Flyfoto` ask a question `Behold` cannot — *give me
 * several of these at once so I can compare and pick* — and this is what
 * happens after their selection dialog: instead of every result being saved,
 * the results become cards in the bottom slot and each one is keep or discard.
 * The discarded ones were never records.
 *
 * Two things make that reasonable rather than reckless, and both are
 * deliberate:
 *
 * **Enumerate everything; fetch one at a time.** Enumeration happens in the
 * dialog and is a catalogue query. *Producing* is a tile burst against a
 * shared public edge, so the run fetches sequentially and only ever aims at
 * the card under the cursor and the one after it. Walking or discarding is
 * what pulls the run forward, which means you start judging the first image
 * while the second is still arriving and the twelfth is never fetched at all
 * if you stop at three.
 *
 * **Keeping does not re-render.** The card already holds the figure it showed
 * you, so keeping writes *those* bytes through `createAttachment` rather than
 * asking the pin queue for a second render of the same parameters. It spares
 * the edge a duplicate burst, and it makes the stored pin literally the pixels
 * the author looked at when they decided.
 */

export type PickerSource = 'lidar' | 'flyfoto';

/** One proposal: everything needed to render it, and to keep it if you do. */
export type PickerCandidate = {
  /** Stable within a run; also the object key React lists on. */
  id: string;
  title: string;
  subtitle: string | null;
  kind: AttachmentKind;
  caption: string;
  /** The spec, as it would be written — `renderSpec` reads it back out. */
  meta: AttachmentMeta;
  spec: ViewSpec;
  /** Checked against the collection once, before the run starts. */
  key: BeholdKey;
};

export type PickerCardState =
  | 'waiting'
  | 'fetching'
  | 'ready'
  | 'empty'
  | 'failed'
  | 'kept';

export type PickerCard = {
  candidate: PickerCandidate;
  state: PickerCardState;
  /** The figure, once it exists: what `Behold` writes and `Last ned` saves. */
  produced: Produced | null;
  /** Object URL over `produced.blob`; revoked when the card or run ends. */
  url: string | null;
};

export type PickerRun = {
  source: PickerSource;
  cards: PickerCard[];
  /** Index into `cards`. Discarding removes a card, so this is not an id. */
  at: number;
  /** How many the dialog handed over, before the duplicate filter. */
  total: number;
  kept: number;
  discarded: number;
  /** Already in the collection, so never proposed — see `start`. */
  skipped: number;
};

type Options = {
  bbox4326: LocalityBbox;
  subject: string | undefined;
  /** `attachmentMatchesKey` over the current collection, from the caller. */
  isDuplicate: (key: BeholdKey) => boolean;
  /** Writes the record. `false` means it failed and the card stays keepable. */
  onKeep: (candidate: PickerCandidate, produced: Produced) => Promise<boolean>;
};

const revokeAll = (run: PickerRun | null) => {
  if (!run) return;
  for (const card of run.cards) if (card.url) URL.revokeObjectURL(card.url);
};

export const usePickerRun = ({
  bbox4326,
  subject,
  isDuplicate,
  onKeep,
}: Options) => {
  const [run, setRun] = useState<PickerRun | null>(null);
  const [keeping, setKeeping] = useState(false);

  // Bumped whenever a run ends. `renderSpec` takes no AbortSignal — a tile
  // burst already in flight cannot actually be stopped — so Esc stops
  // *starting* fetches and drops the result of the one that is out.
  const generation = useRef(0);
  // The generation the in-flight fetch belongs to, or null. Comparing against
  // `generation` rather than holding a bare boolean is what lets a new run
  // start immediately after Esc instead of waiting on the abandoned burst.
  const fetchingGen = useRef<number | null>(null);
  const keepingRef = useRef(false);
  // Read by the stable callbacks below, which must not be re-created every
  // time a card changes state — the key handlers close over them.
  const runRef = useRef(run);
  runRef.current = run;
  const opts = useRef({ bbox4326, subject, isDuplicate, onKeep });
  opts.current = { bbox4326, subject, isDuplicate, onKeep };

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

  // The worker. One fetch at a time, aimed at the cursor and then one ahead;
  // it re-arms itself because finishing a fetch changes `run`.
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

    renderSpec(candidate.spec, opts.current.bbox4326, opts.current.subject)
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

  // A run outlives no surface: leaving the lokalitet drops it, and the object
  // URLs with it.
  useEffect(() => () => revokeAll(runRef.current), []);

  /**
   * Take the bottom slot with a fresh run. Whatever was there is ended: the
   * slot holds one occupant, and a picker is one of them (§4.3).
   */
  const start = useCallback(
    (source: PickerSource, candidates: PickerCandidate[]) => {
      generation.current += 1;
      revokeAll(runRef.current);
      // The duplicate guard, and it fires *before* the tile burst rather than
      // after: something already in the collection is not a proposal, and
      // fetching it would be the one request the run exists to avoid. Under
      // §4.1.2 keeping is free, so removing the cost removed the brake and
      // this has to be it.
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

  /** `Ferdig`, and `Esc`: end the run, cancel what has not been fetched. */
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

  /**
   * Discard: the card leaves the rail rather than greying out (§4.3), which
   * is what makes "eight of twelve" visible as a shrinking rail rather than
   * as a tally you have to read.
   */
  const discard = useCallback(() => {
    const prev = runRef.current;
    if (!prev) return;
    const card = prev.cards[prev.at];
    // A kept card has a record behind it; throwing it off the rail would
    // either lie or delete, so it has no discard.
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

  /**
   * Keep: write the record, now, with the bytes the card is showing.
   *
   * §4.3 says the kept ones "join the collection" when the picker closes, and
   * they do — the collection carousel is not on screen while the picker holds
   * the slot. But the *write* happens on the press, so that `Esc` cancels only
   * fetching and can never throw away a decision, and so the card can show a
   * receipt instead of a promise.
   *
   * The card stays on the rail, marked. Discarding removes; keeping marks —
   * an author who keeps five of twelve should be able to see which five.
   */
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
  };
};

export type PickerApi = ReturnType<typeof usePickerRun>;
