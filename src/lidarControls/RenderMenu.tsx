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
import { ControlChip } from '../ui/ControlChip';
import { Icon, type MaterialSymbol } from '../ui/Icon';
import styles from './controls.module.css';
import type { LidarControls } from './useLidarControls';

// What each render does to the height model, in one glyph. The pairs are the
// point: a half-lit disc against a burst of rays is one sun against many, which
// is the whole difference between the two hillshades; a per-cent sign against a
// set square is the same slope read in two units.
//
// `cvat` keeps `database` rather than a second sun. It is a hillshade too, but
// the fact worth a glyph there is that it came off our own disk — every other
// render on this menu is Kartverket's.
//
// The list is open: `lidarStyleLabel` prettifies a suffix GetCapabilities
// advertises and we have never seen, so an unmapped style falls back to the
// generic `texture` rather than to nothing.
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

  // The one ground whose relief nobody upstream computed has to say so; every
  // other render on this menu is Kartverket's picture of Kartverket's heights.
  const hint = isLidarCvat
    ? t('lidarControls.render.cvatHint')
    : t('lidarControls.render.wmsHint');

  // Icon alone: the names are long ("Multiskyggerelieff"), and which render is
  // drawing is the one thing in this row the reader can see by looking at
  // the map. What the picture does not say is whose render it is, so the cache
  // keeps the `database` icon it carries on its own row below.
  const chipIcon = isLidarCvat ? 'database' : styleIcon(shownStyle);
  const chipTitle = t('lidarControls.render.chipTitle', {
    render: label,
    source: hint,
  });

  // DOM publishes one style, so there is nothing to choose — and the cache goes
  // with it, since it was computed from terrain and has no surface twin. No
  // Menu at all rather than a menu of one: a chevron over a single row promises
  // a choice that is not there.
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

  // The check moved right so the left slot can say what the render *is* on
  // every row, checked or not — a gutter that only fills in when a row is
  // active makes the reader compare names to find the other pictures.
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

  // Only on a flight: the national mosaic is never in the store, so saying the
  // cache has nothing for it would be noise rather than a fallback notice.
  const cacheMissing = isLidarFlight && activeLidarProject && !activeCvat;

  return (
    <Menu width={320}>
      <Menu.Target>
        {/* Automatisk does not pick the render, but every dataset it picks
            re-derives one through `preferredLidarRender` — so while it is on,
            this is its answer as much as the reader's. Dimmed for that, and
            choosing here pins the dataset too. */}
        <ControlChip
          icon={chipIcon}
          title={chipTitle}
          aria-label={chipTitle}
          dimmed={autoDataset}
        />
      </Menu.Target>
      <Menu.Dropdown>
        {/* The provenance, where the reader is choosing between pictures rather
            than behind a hover. A figure taken over this ground carries the same
            facts on its plate; this is the on-screen half of that. Not a Tooltip
            on the chip: `Menu.Target` and `Tooltip` both clone their single
            child, and nesting the two is undocumented in both directions. */}
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
