import { atom } from 'jotai';

// Its own file: AuthDialog is mounted at shell level but triggered from
// several places.
export const isAuthDialogOpenAtom = atom(false);
