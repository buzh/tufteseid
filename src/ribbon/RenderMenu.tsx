// Which render of the dataset is drawing. On a flight this is also which ground
// the map is on — `lidarCvat` when the picture came off our own disk,
// `lidarProject` when Kartverket's WMS drew it — which is why every row here
// goes through `selectStyle` rather than writing the style atom.
//
// Arkeologisk relieff leads the list wherever the store holds the flight, and is
// absent where it does not. The absence is spelled out rather than left as a
// missing row: "the cache has nothing for this dataset, so you are looking at
// the WMS" is the single most useful thing this menu can say.

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
import { Icon } from '../ui/Icon';
import { RibbonChip } from './RibbonChip';
import styles from './Ribbon.module.css';
import type { LidarControls } from './useLidarControls';

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
  } = lidar;

  const label = lidarStyleLabel(shownStyle);

  // The one ground whose relief nobody upstream computed has to say so; every
  // other render on this menu is Kartverket's picture of Kartverket's heights.
  const hint = isLidarCvat
    ? t('ribbon.render.cvatHint')
    : t('ribbon.render.wmsHint');

  // DOM publishes one style, so there is nothing to choose — and the cache goes
  // with it, since it was computed from terrain and has no surface twin. No
  // Menu at all rather than a menu of one: a chevron over a single row promises
  // a choice that is not there.
  if (lidarModel === 'dom') {
    return (
      <Tooltip label={t('ribbon.render.domLocked')}>
        <RibbonChip
          icon="texture"
          label={label}
          hint={hint}
          withChevron={false}
          className={styles.chipStatic}
        />
      </Tooltip>
    );
  }

  const row = (style: string) => (
    <Menu.Item
      key={style}
      onClick={() => selectStyle(style)}
      leftSection={
        style === shownStyle ? (
          <Icon icon="check" size={18} />
        ) : style === CVAT_STYLE ? (
          <Icon icon="database" size={18} />
        ) : (
          <span className={styles.gutter} />
        )
      }
    >
      <Text size="sm">{lidarStyleLabel(style)}</Text>
      {style === CVAT_STYLE && (
        <Text size="xs" c="dimmed">
          {t('ribbon.render.cvatHint')}
        </Text>
      )}
    </Menu.Item>
  );

  // Only on a flight: the national mosaic is never in the store, so saying the
  // cache has nothing for it would be noise rather than a fallback notice.
  const cacheMissing = isLidarFlight && activeLidarProject && !activeCvat;

  return (
    <Menu width={320}>
      <Menu.Target>
        <RibbonChip icon="texture" label={label} hint={hint} />
      </Menu.Target>
      <Menu.Dropdown>
        {/* The provenance, where the reader is choosing between pictures rather
            than behind a hover. A figure taken over this ground carries the same
            facts on its plate; this is the on-screen half of that. Not a Tooltip
            on the chip: `Menu.Target` and `Tooltip` both clone their single
            child, and nesting the two is undocumented in both directions. */}
        {isLidarCvat && activeCvat && (
          <Menu.Label className={styles.provenance}>
            {t('ribbon.render.cvatProvenance', {
              acquisition: activeCvat.project.projectName,
              renderer: CVAT_RENDERER,
              template: CVAT_TEMPLATE,
              general: CVAT_RADIUS_PX.general,
              flat: CVAT_RADIUS_PX.flat,
            })}
          </Menu.Label>
        )}
        {cacheMissing && (
          <Menu.Item disabled leftSection={<Icon icon="database" size={18} />}>
            <Text size="sm">{lidarStyleLabel(CVAT_STYLE)}</Text>
            <Text size="xs" c="dimmed">
              {t('ribbon.render.cvatMissing')}
            </Text>
          </Menu.Item>
        )}
        {tierAStyles.map(row)}
        {tierBStyles.length > 0 && (
          <>
            <Menu.Label>{t('ribbon.render.more')}</Menu.Label>
            {tierBStyles.map(row)}
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
};
