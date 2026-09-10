import { atom } from 'jotai';

// Kept in its own file because AuthDialog is mounted at shell level
// but triggered from many places (RibbonAccount, and any "sign in to save"
// callout in the finds panels).
export const isAuthDialogOpenAtom = atom(false);
