import { useEffect, useState } from 'react';

import { getRegistrationGate, type RegistrationGate } from '../api/invites';

/** The closed beta's state, re-read each time the box opens: free places are
 *  taken while the page is up. Null is "not known" — an installation whose
 *  `registration` row is missing gates nothing and says nothing. */
export const useRegistrationGate = (open: boolean) => {
  const [gate, setGate] = useState<RegistrationGate | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    getRegistrationGate()
      .then((row) => {
        if (live) setGate(row);
      })
      .catch((err) => {
        console.warn('[auth] reading the registration gate failed', err);
      });
    return () => {
      live = false;
    };
  }, [open]);

  return gate;
};
