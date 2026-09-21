// Which LiDAR dataset the map is reading: the national mosaic, or one
// acquisition. Rows come off `lidarViewportAtom`, which the footprint layer
// fills from the same WFS pass that draws the outlines — so hovering a row
// paints where it lies.
//
// Automatisk is not a row here; it is the button beside the chip. While it is
// on this menu is dimmed and every row in it still works — clicking one is how
// the reader takes the choice back.

import { Badge, Group, Menu, ScrollArea, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { LidarProject } from '../map/layers/config/backgroundLayers/lidarProjects';
import type { LidarViewportEntry } from '../map/layers/config/backgroundLayers/lidarRelevance';
import { ControlChip } from '../ui/ControlChip';
import { Icon } from '../ui/Icon';
import styles from './controls.module.css';
import type { LidarControls } from './useLidarControls';

/** "2025 · 10pkt", the two things that rank one flight against another. */
const flightFacts = (p: LidarProject): string =>
  [p.year, p.pointDensity].filter(Boolean).join(' · ');

export const DatasetMenu = ({ lidar }: { lidar: LidarControls }) => {
  const { t } = useTranslation();
  const {
    activeLidarProject,
    cachedFlightIds,
    viewport,
    autoDataset,
    isNationalMosaic,
    isLidarFlight,
    activateNational,
    activateProject,
    pickerOpen,
    setPickerOpen,
    setHoveredProjectId,
  } = lidar;

  // The year and the density, not the project name: "Vestfold" is where the
  // reader already is, while the two facts that rank one flight against another
  // are what the chip is being read for. The name is a hover away in `title`,
  // and spelled out on the checked row of the menu this opens.
  const flight = isLidarFlight ? activeLidarProject : null;
  const shown = flight
    ? flightFacts(flight) || flight.projectName
    : t('lidarControls.dataset.nationalShort');
  const title = flight
    ? `${flight.projectName} · ${flightFacts(flight)}`
    : `${t('lidarControls.dataset.national')} · ${t('lidarControls.dataset.nationalHint')}`;

  const row = (entry: LidarViewportEntry) => {
    const { project, areaRatio } = entry;
    const active = isLidarFlight && activeLidarProject?.id === project.id;
    return (
      <Menu.Item
        key={project.id}
        onClick={() => activateProject(project)}
        onMouseEnter={() => setHoveredProjectId(project.id)}
        onMouseLeave={() => setHoveredProjectId(null)}
        leftSection={
          active ? <Icon icon="check" size={18} /> : <span className={styles.gutter} />
        }
      >
        <Group gap="xs" wrap="nowrap" justify="space-between">
          <div>
            <Text size="sm">{project.projectName}</Text>
            <Text size="xs" c="dimmed">
              {flightFacts(project)} ·{' '}
              {t('lidarControls.dataset.coverage', {
                percent: Math.round(areaRatio * 100),
              })}
            </Text>
          </div>
          {/* The store having rendered a flight is not a tiebreak — it does not
              make the flight a better reading of the ground. It is said here
              because it is the difference between the two pictures the reader
              can ask for of it. */}
          {cachedFlightIds.has(project.id) && (
            <Badge size="xs" variant="light" leftSection={<Icon icon="database" size={12} />}>
              {t('lidarControls.dataset.cached')}
            </Badge>
          )}
        </Group>
      </Menu.Item>
    );
  };

  const status = () => {
    if (viewport.status === 'loading' || viewport.status === 'idle') {
      return (
        <Menu.Item disabled>{t('lidarControls.dataset.loading')}</Menu.Item>
      );
    }
    if (viewport.status === 'zoomedOut') {
      return (
        <Menu.Item disabled leftSection={<Icon icon="zoom_in" size={18} />}>
          {t('lidarControls.dataset.zoomedOut')}
        </Menu.Item>
      );
    }
    if (viewport.status === 'error') {
      return (
        <Menu.Item disabled leftSection={<Icon icon="warning" size={18} />}>
          {t('lidarControls.dataset.error')}
        </Menu.Item>
      );
    }
    if (viewport.primary.length + viewport.secondary.length === 0) {
      return <Menu.Item disabled>{t('lidarControls.dataset.none')}</Menu.Item>;
    }
    return null;
  };

  return (
    <Menu
      opened={pickerOpen}
      onChange={(open) => {
        setPickerOpen(open);
        if (!open) setHoveredProjectId(null);
      }}
      width={360}
    >
      <Menu.Target>
        {/* A flight is one aircraft over one county on one day, and the chip's
            own facts — the year and the density — are facts about that flight.
            The mosaic is not a flight: it keeps `layers`, because what it is is
            every flight stacked and levelled to 1 m. */}
        <ControlChip
          icon={flight ? 'flight' : 'layers'}
          label={shown}
          title={title}
          aria-label={title}
          dimmed={autoDataset}
        />
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          onClick={activateNational}
          leftSection={
            isNationalMosaic ? (
              <Icon icon="check" size={18} />
            ) : (
              <span className={styles.gutter} />
            )
          }
        >
          <Text size="sm">{t('lidarControls.dataset.national')}</Text>
          <Text size="xs" c="dimmed">
            {t('lidarControls.dataset.nationalHint')}
          </Text>
        </Menu.Item>

        <ScrollArea.Autosize mah={340} type="scroll">
          {status()}
          {viewport.primary.length > 0 && (
            <>
              <Menu.Label>{t('lidarControls.dataset.inView')}</Menu.Label>
              {viewport.primary.map(row)}
            </>
          )}
          {viewport.secondary.length > 0 && (
            <>
              <Menu.Label>{t('lidarControls.dataset.alsoHere')}</Menu.Label>
              {viewport.secondary.map(row)}
            </>
          )}
        </ScrollArea.Autosize>
      </Menu.Dropdown>
    </Menu>
  );
};
