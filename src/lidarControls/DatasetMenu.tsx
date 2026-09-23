import { Badge, Group, Menu, ScrollArea, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { LidarProject } from '../map/layers/config/backgroundLayers/lidarProjects';
import type { LidarViewportEntry } from '../map/layers/config/backgroundLayers/lidarRelevance';
import { ControlChip } from '../ui/ControlChip';
import { Icon } from '../ui/Icon';
import styles from './controls.module.css';
import type { LidarControls } from './useLidarControls';

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

  const flight = isLidarFlight ? activeLidarProject : null;
  const shown = flight
    ? flightFacts(flight) || flight.projectName
    : t('lidarControls.dataset.nationalShort');
  const title = flight
    ? `${flight.projectName} · ${flightFacts(flight)}`
    : `${t('lidarControls.dataset.national')} · ${t('lidarControls.dataset.nationalHint')}`;

  // Kartverket is not answering; the rows are the cVAT store's own.
  const held = viewport.status === 'held';

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
          active ? (
            <Icon icon="check" size={18} />
          ) : (
            <span className={styles.gutter} />
          )
        }
      >
        <Group gap="xs" wrap="nowrap" justify="space-between">
          <div>
            <Text size="sm">{project.projectName}</Text>
            {/* Held rows are ranked on the store's envelopes, so a coverage
                percentage would be an upper bound rather than a measurement. */}
            <Text size="xs" c="dimmed">
              {held
                ? flightFacts(project)
                : `${flightFacts(project)} · ${t(
                    'lidarControls.dataset.coverage',
                    {
                      percent: Math.round(areaRatio * 100),
                    },
                  )}`}
            </Text>
          </div>
          {cachedFlightIds.has(project.id) && (
            <Badge
              size="xs"
              variant="light"
              leftSection={<Icon icon="database" size={12} />}
            >
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
    if (viewport.status === 'held') {
      return (
        <Menu.Item disabled leftSection={<Icon icon="cloud_off" size={18} />}>
          {t('lidarControls.dataset.held')}
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
            {held
              ? t('lidarControls.dataset.nationalHeldHint')
              : t('lidarControls.dataset.nationalHint')}
          </Text>
        </Menu.Item>

        <ScrollArea.Autosize mah={340} type="scroll">
          {status()}
          {viewport.primary.length > 0 && (
            <>
              <Menu.Label>
                {t(
                  held
                    ? 'lidarControls.dataset.heldInView'
                    : 'lidarControls.dataset.inView',
                )}
              </Menu.Label>
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
