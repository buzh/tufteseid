import { useAtom } from 'jotai';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LocalitiesPanel } from '../../localities/LocalitiesPanel';
import { IconButton } from '../../ui';
import { mapToolAtom } from './atoms';
import styles from './MapToolCards.module.css';

export const MapToolCards = () => {
  const { t } = useTranslation();
  const [currentMapTool, setCurrentMapTool] = useAtom(mapToolAtom);

  const onClose = () => setCurrentMapTool(null);

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
