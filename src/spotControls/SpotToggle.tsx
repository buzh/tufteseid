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

  const busy = placing || draft != null;

  const label = !signedIn
    ? t('spots.newNeedsAccount')
    : draft
      ? t('spots.done')
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
