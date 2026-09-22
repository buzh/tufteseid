// Kulturminner, on or off. The whole control is the box: one press puts the
// heritage record over whatever ground is drawing, the next takes it off, and
// the papaya fill is the state.
//
// Off is a blind rather than a clearing — the ticked sources, the registers and
// the render all survive it (`useHeritageControls`), so a reader who takes the
// overlay off to look at the terrain gets their own selection back rather than
// the default one.

import { Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { ControlButton } from '../ui/ControlButton';
import type { HeritageControls } from './useHeritageControls';

export const HeritageToggle = ({
  heritage,
}: {
  heritage: HeritageControls;
}) => {
  const { t } = useTranslation();
  const { shown, toggleShown } = heritage;

  return (
    // The tooltip says what the click does, which is the opposite thing in each
    // state; the label is the same word either way and cannot.
    <Tooltip
      label={shown ? t('heritageControls.hide') : t('heritageControls.show')}
    >
      <ControlButton
        icon="castle"
        on={shown}
        aria-label={t('heritageControls.label')}
        aria-pressed={shown}
        onClick={toggleShown}
      />
    </Tooltip>
  );
};
