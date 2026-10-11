import { useEffect, useState } from 'react';

import { type Capacity, getCapacity } from '../api/capacity';
import { getRegistrationGate, type RegistrationGate } from '../api/invites';

/** Re-read each time the surface showing it opens: both of these move while
 *  the page is up. Null is "not known" — a gate an installation does not
 *  have, or a read that failed — and nothing is put on the screen for it. */
const useWhileOpen = <T>(
  open: boolean,
  read: () => Promise<T | null>,
  what: string,
): T | null => {
  const [value, setValue] = useState<T | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    read()
      .then((row) => {
        if (live) setValue(row);
      })
      .catch((err: unknown) => {
        console.warn(`[auth] reading ${what} failed`, err);
      });
    return () => {
      live = false;
    };
  }, [open, read, what]);

  return value;
};

/** The closed beta's state: how many free places are left
 *  (`docs/closed-beta.md`). */
export const useRegistrationGate = (open: boolean): RegistrationGate | null =>
  useWhileOpen(open, getRegistrationGate, 'the registration gate');

/** The user cap, which is a separate thing from the beta's free places: how
 *  many accounts hold a place and how many there are (`docs/identity.md`). */
export const useCapacity = (open: boolean): Capacity | null =>
  useWhileOpen(open, getCapacity, 'the user cap');
