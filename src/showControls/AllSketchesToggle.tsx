import { Tooltip } from '@mantine/core';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { allSketchesShownAtom } from '../sketch/allSketches';
import { ControlButton } from '../ui/ControlButton';

export const AllSketchesToggle = () => {
  const { t } = useTranslation();
  const [shown, setShown] = useAtom(allSketchesShownAtom);

  return (
    <Tooltip
      label={shown ? t('spots.allSketchesHide') : t('spots.allSketchesShow')}
    >
      <ControlButton
        icon="draw_collage"
        on={shown}
        aria-label={t('spots.allSketchesLabel')}
        aria-pressed={shown}
        onClick={() => setShown(!shown)}
      />
    </Tooltip>
  );
};
