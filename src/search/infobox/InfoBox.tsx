import { useAtom, useSetAtom } from 'jotai';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, cx, IconButton } from '../../ui';
import { searchCoordinatesAtom, selectedResultAtom } from '../atoms';
import styles from './InfoBox.module.css';
import { InfoBoxPreamble } from './InfoBoxPreamble';
import { InfoBoxSections } from './InfoBoxSections';

export const InfoBox = () => {
  const [selectedResult, setSelectedResult] = useAtom(selectedResultAtom);
  const setClickedCoordinate = useSetAtom(searchCoordinatesAtom);
  const { t } = useTranslation();
  const [isMinimized, setIsMinimized] = useState(false);

  const onClose = useCallback(() => {
    setSelectedResult(null);
    setClickedCoordinate(null);
  }, [setSelectedResult, setClickedCoordinate]);

  if (selectedResult === null) {
    return null;
  }

  // A coordinate's "name" is the coordinate itself, which the coordinate
  // section already spells out properly.
  const showHeading =
    selectedResult.type !== 'Coordinate' && selectedResult.name;

  return (
    <div
      className={cx(styles.panel, isMinimized && styles.minimized)}
      data-chrome="right"
    >
      <div className={styles.head}>
        <Button
          size="sm"
          leftIcon={isMinimized ? 'keyboard_arrow_down' : 'keyboard_arrow_up'}
          onClick={() => setIsMinimized((prev) => !prev)}
        >
          {isMinimized ? t('infoBox.showContent') : t('infoBox.hideContent')}
        </Button>
        <IconButton
          icon="close"
          size="sm"
          palette="red"
          aria-label={t('shared.close')}
          onClick={onClose}
        />
      </div>
      {/* Hidden rather than unmounted while minimized. `PropertyInfo` draws
          the property outline on the map and clears it on unmount, and
          folding the panel away to look at that outline is the point of
          folding it away. */}
      <div className={cx(styles.folds, isMinimized && styles.hidden)}>
        {showHeading && (
          <h2 className={styles.heading}>{selectedResult.name}</h2>
        )}
        <InfoBoxPreamble result={selectedResult} />
        <div className={styles.body}>
          <InfoBoxSections />
        </div>
      </div>
    </div>
  );
};
