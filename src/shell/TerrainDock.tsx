import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { activeLocalityAtom } from '../localities/atoms';
import { terrainStandaloneBboxAtom } from '../terrain/atoms';
import { TerrainPanel } from '../terrain/TerrainPanel';
import { IconButton, Tooltip } from '../ui';
import { Dock } from './Dock';
import styles from './LocalityDock.module.css';

/**
 * Terrenganalyse over the bare map — no lokalitet, no account.
 *
 * The dock a lokalitet gets is not available here, so this is the same frame
 * with the panel as its only occupant. The two can never be live at once:
 * opening a lokalitet clears the standalone rectangle, and with a lokalitet
 * open the panel renders in that dock's tool band instead, over the
 * lokalitet's own bbox. That is what keeps "which rectangle does Lagre keep"
 * to one answer.
 */
export const TerrainDock = () => {
  const { t } = useTranslation();
  const locality = useAtomValue(activeLocalityAtom);
  const [bbox, setBbox] = useAtom(terrainStandaloneBboxAtom);

  if (locality || !bbox) return null;

  return (
    <Dock
      head={
        <>
          <span className={styles.title}>
            {t('localities.terrain.heading')}
          </span>
          <div className={styles.spacer} />
          <Tooltip label={t('localities.terrain.close')}>
            <IconButton
              icon="close"
              size="sm"
              palette="gray"
              aria-label={t('localities.terrain.close')}
              onClick={() => setBbox(null)}
            />
          </Tooltip>
        </>
      }
    >
      <TerrainPanel bbox={bbox} locality={null} />
    </Dock>
  );
};
