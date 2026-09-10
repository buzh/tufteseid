import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { activeLocalityAtom } from '../localities/atoms';
import { ribbonToolAtom } from '../localities/toolAtoms';
import { terrainStandaloneBboxAtom } from '../terrain/atoms';
import { TerrainPanel } from '../terrain/TerrainPanel';
import { cx, IconButton } from '../ui';
import styles from './Ribbon.module.css';
import terrainStyles from './RibbonTerrainRow.module.css';

/**
 * Row 3, terrain — the one tool surface that is not a lokalitet feature, and
 * so the one the ribbon renders itself rather than leaving to LocalityRibbon.
 *
 * Two entrances, one surface. With a lokalitet open the workspace owns the
 * flag, which is what keeps the tool surfaces and the tray mutually
 * exclusive; with none, the rectangle row 1 framed is both the state and the
 * subject. Neither can be live at once — opening a lokalitet clears the
 * standalone rectangle — so "which bbox" has one answer.
 */
export const RibbonTerrainRow = () => {
  const { t } = useTranslation();
  const locality = useAtomValue(activeLocalityAtom);
  const [tool, setTool] = useAtom(ribbonToolAtom);
  const [standaloneBbox, setStandaloneBbox] = useAtom(
    terrainStandaloneBboxAtom,
  );

  const bbox = locality
    ? tool === 'terrain'
      ? locality.bbox
      : null
    : standaloneBbox;
  if (!bbox) return null;

  return (
    <div className={cx(styles.rowSub, terrainStyles.root)}>
      <div className={terrainStyles.head}>
        <h3 className={terrainStyles.title}>
          {t('localities.terrain.heading')}
        </h3>
        <IconButton
          icon="close"
          size="xs"
          palette="gray"
          aria-label={t('localities.terrain.close')}
          onClick={() => (locality ? setTool(null) : setStandaloneBbox(null))}
        />
      </div>
      <TerrainPanel bbox={bbox} locality={locality} />
    </div>
  );
};
