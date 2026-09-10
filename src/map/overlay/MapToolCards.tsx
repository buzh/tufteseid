import { useAtom } from 'jotai';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LocalitiesPanel } from '../../localities/LocalitiesPanel';
import { MapThemes } from '../../settings/map/themes/MapThemes';
import { CountBadge, IconButton, Tooltip } from '../../ui';
import { activeThemeLayersAtom } from '../layers/atoms';
import { mapToolAtom } from './atoms';
import styles from './MapToolCards.module.css';

const MapLayersCardHeader = () => {
  const { t } = useTranslation();
  const [activeThemeLayers, setActiveThemeLayers] = useAtom(
    activeThemeLayersAtom,
  );
  return (
    <div className={styles.layersHeader}>
      <h2 className={styles.title}>{t('mapLayers.label')}</h2>
      {activeThemeLayers.size > 0 && (
        <>
          <CountBadge count={activeThemeLayers.size} palette="yellow" />
          <Tooltip label={t('map.settings.layers.theme.resetbutton.text')}>
            <IconButton
              icon="playlist_remove"
              palette="red"
              aria-label={t('map.settings.layers.theme.resetbutton.text')}
              onClick={() => setActiveThemeLayers(new Set())}
            />
          </Tooltip>
        </>
      )}
    </div>
  );
};

export const MapToolCards = () => {
  const { t } = useTranslation();
  const [currentMapTool, setCurrentMapTool] = useAtom(mapToolAtom);

  const onClose = () => setCurrentMapTool(null);

  if (currentMapTool === 'layers') {
    return (
      <MapToolCard header={<MapLayersCardHeader />} onClose={onClose}>
        <MapThemes />
      </MapToolCard>
    );
  }

  if (currentMapTool === 'localities') {
    return (
      <MapToolCard
        header={
          <h2 className={styles.title}>{t('localities.panel.tabHeading')}</h2>
        }
        onClose={onClose}
      >
        <LocalitiesPanel />
      </MapToolCard>
    );
  }

  return null;
};

const MapToolCard = ({
  header,
  children,
  onClose,
}: {
  header: ReactNode;
  children: ReactNode;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  return (
    <div className={styles.card} data-chrome="left">
      <div className={styles.head}>
        {header}
        <IconButton
          icon="close"
          palette="red"
          aria-label={t('shared.close')}
          onClick={onClose}
        />
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  );
};
