import { useEffect, useState } from 'react';

import { type Capacity, getCapacity } from '../api/capacity';
import { getRegistrationGate, type RegistrationGate } from '../api/invites';

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

export const useRegistrationGate = (open: boolean): RegistrationGate | null =>
  useWhileOpen(open, getRegistrationGate, 'the registration gate');

export const useCapacity = (open: boolean): Capacity | null =>
  useWhileOpen(open, getCapacity, 'the user cap');
