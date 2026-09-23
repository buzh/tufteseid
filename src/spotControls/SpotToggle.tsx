// The `+`: start a spot here. One press puts the pin on the cursor and waits
// for a click on the ground it belongs to; that click opens the box beside it.
// The next press — armed, or with a draft open — puts the pin down again.
//
// It arms rather than places because a pin the reader aimed is worth more than
// a pin the app guessed. Dropping one at the centre of the screen made the
// reader's first gesture a correction, and opened a box over ground nobody had
// pointed at.
//
// Signed out it opens the sign-in dialog instead, and does not pretend
// otherwise — the tooltip says so. The alternative is letting a reader place a
// pin, write a name, a description and a sketch, and only then telling them
// there is nowhere to put it.

import { Tooltip } from '@mantine/core';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { isAuthDialogOpenAtom, isSignedInAtom } from '../auth/atoms';
import {
  closeSpotDraftAtom,
  spotDraftAtom,
  spotPlacingAtom,
} from '../spots/atoms';
import { ControlButton } from '../ui/ControlButton';

export const SpotToggle = () => {
  const { t } = useTranslation();
  const signedIn = useAtomValue(isSignedInAtom);
  const draft = useAtomValue(spotDraftAtom);
  const [placing, setPlacing] = useAtom(spotPlacingAtom);
  const openDialog = useSetAtom(isAuthDialogOpenAtom);
  const closeDraft = useSetAtom(closeSpotDraftAtom);

  // Lit for both halves of the gesture: the button is on from the press that
  // takes up the pin until the spot is saved or abandoned.
  const busy = placing || draft != null;

  const label = !signedIn
    ? t('spots.newNeedsAccount')
    : draft
      ? t('spots.abort')
      : placing
        ? t('spots.placeCancel')
        : t('spots.new');

  return (
    <Tooltip label={label}>
      <ControlButton
        icon="add_location"
        on={busy}
        aria-label={t('spots.new')}
        aria-pressed={busy}
        onClick={() => {
          if (!signedIn) openDialog(true);
          else if (draft) closeDraft();
          else setPlacing(!placing);
        }}
      />
    </Tooltip>
  );
};
