import { Menu, Text, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import {
  CVAT_RADIUS_PX,
  CVAT_RENDERER,
  CVAT_TEMPLATE,
} from '../map/layers/config/backgroundLayers/cvatGround';
import {
  CVAT_STYLE,
  lidarStyleLabel,
} from '../map/layers/config/backgroundLayers/lidarProjects';
import { ControlChip } from '../ui/ControlChip';
import { Icon, type MaterialSymbol } from '../ui/Icon';
import styles from './controls.module.css';
import type { LidarControls } from './useLidarControls';

// Open-ended: GetCapabilities may advertise a style not listed here, which
// falls back to `texture`.
const STYLE_ICONS: Record<string, MaterialSymbol> = {
  [CVAT_STYLE]: 'database',
  skyggerelieff: 'contrast',
  multiskyggerelieff: 'flare',
  helning_prosent: 'percent',
  helning_grader: 'square_foot',
};

const styleIcon = (style: string): MaterialSymbol =>
  STYLE_ICONS[style] ?? 'texture';

export const RenderMenu = ({ lidar }: { lidar: LidarControls }) => {
  const { t } = useTranslation();
  const {
    tierAStyles,
    tierBStyles,
    shownStyle,
    selectStyle,
    isLidarCvat,
    isLidarFlight,
    activeLidarProject,
    activeCvat,
    lidarModel,
    autoDataset,
  } = lidar;

  const label = lidarStyleLabel(shownStyle);

  const hint = isLidarCvat
    ? t('lidarControls.render.cvatHint')
    : t('lidarControls.render.wmsHint');

  const chipIcon = isLidarCvat ? 'database' : styleIcon(shownStyle);
  const chipTitle = t('lidarControls.render.chipTitle', {
    render: label,
    source: hint,
  });

  // DOM publishes one style, and the cache is terrain-only, so nothing to pick.
  if (lidarModel === 'dom') {
    return (
      <Tooltip label={t('lidarControls.render.domLocked')}>
        <ControlChip
          icon={chipIcon}
          aria-label={chipTitle}
          withChevron={false}
          readout
        />
      </Tooltip>
    );
  }

  const row = (style: string) => (
    <Menu.Item
      key={style}
      onClick={() => selectStyle(style)}
      leftSection={<Icon icon={styleIcon(style)} size={18} />}
      rightSection={
        style === shownStyle ? <Icon icon="check" size={18} /> : undefined
      }
    >
      <Text size="sm">{lidarStyleLabel(style)}</Text>
      {style === CVAT_STYLE && (
        <Text size="xs" c="dimmed">
          {t('lidarControls.render.cvatHint')}
        </Text>
      )}
    </Menu.Item>
  );

  // The national mosaic is never in the cVAT store.
  const cacheMissing = isLidarFlight && activeLidarProject && !activeCvat;

  return (
    <Menu width={320}>
      <Menu.Target>
        <ControlChip
          icon={chipIcon}
          title={chipTitle}
          aria-label={chipTitle}
          dimmed={autoDataset}
        />
      </Menu.Target>
      <Menu.Dropdown>
        {/* Not a Tooltip on the chip: `Menu.Target` and `Tooltip` both clone
            their single child. */}
        {isLidarCvat && activeCvat && (
          <Menu.Label className={styles.provenance}>
            {t('lidarControls.render.cvatProvenance', {
              acquisition: activeCvat.project.projectName,
              renderer: CVAT_RENDERER,
              template: CVAT_TEMPLATE,
              general: CVAT_RADIUS_PX.general,
              flat: CVAT_RADIUS_PX.flat,
            })}
          </Menu.Label>
        )}
        {cacheMissing && (
          <Menu.Item
            disabled
            leftSection={<Icon icon={styleIcon(CVAT_STYLE)} size={18} />}
          >
            <Text size="sm">{lidarStyleLabel(CVAT_STYLE)}</Text>
            <Text size="xs" c="dimmed">
              {t('lidarControls.render.cvatMissing')}
            </Text>
          </Menu.Item>
        )}
        {tierAStyles.map(row)}
        {tierBStyles.length > 0 && (
          <>
            <Menu.Label>{t('lidarControls.render.more')}</Menu.Label>
            {tierBStyles.map(row)}
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
};
