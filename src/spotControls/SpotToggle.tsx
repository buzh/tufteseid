// The `+`: start a spot here. One press puts a pin at the middle of what you
// are looking at and opens the box beside it; the next press, while a draft is
// open, puts that draft down.
//
// Signed out it opens the sign-in dialog instead of a draft, and does not
// pretend otherwise — the tooltip says so. The alternative is letting a reader
// write a name, a description and a sketch and only then telling them there is
// nowhere to put it.

import { Tooltip } from '@mantine/core';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { isAuthDialogOpenAtom, isSignedInAtom } from '../auth/atoms';
import {
  closeSpotDraftAtom,
  openSpotDraftAtom,
  spotDraftAtom,
} from '../spots/atoms';
import { ControlButton } from '../ui/ControlButton';

export const SpotToggle = () => {
  const { t } = useTranslation();
  const signedIn = useAtomValue(isSignedInAtom);
  const draft = useAtomValue(spotDraftAtom);
  const openDialog = useSetAtom(isAuthDialogOpenAtom);
  const openDraft = useSetAtom(openSpotDraftAtom);
  const closeDraft = useSetAtom(closeSpotDraftAtom);

  const label = !signedIn
    ? t('spots.newNeedsAccount')
    : draft
      ? t('spots.abort')
      : t('spots.new');

  return (
    <Tooltip label={label}>
      <ControlButton
        icon="add_location"
        on={draft != null}
        aria-label={t('spots.new')}
        aria-pressed={draft != null}
        onClick={() => {
          if (!signedIn) openDialog(true);
          else if (draft) closeDraft();
          else openDraft();
        }}
      />
    </Tooltip>
  );
};
