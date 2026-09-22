import { atom } from 'jotai';
import type { FeatureInfoReading } from './types';

// The two readings a pointer over the Kulturminner layers produces, and the one
// place they are held. Two atoms rather than one with a mode, because they have
// different lifetimes: the tip is gone the moment the pointer moves, the card
// stays until it is dismissed, and a reader hovering elsewhere while a card is
// open is doing two things at once.
//
// `layers/atoms.ts` prunes both when a theme layer is switched off, so a reading
// never outlives the register it came out of.

/** What a resting pointer found: the mouseover, and nothing the reader chose. */
export const heritageTipAtom = atom<FeatureInfoReading | null>(null);

/** What a click found: the card, with the details and the outward links. */
export const heritagePopupAtom = atom<FeatureInfoReading | null>(null);
