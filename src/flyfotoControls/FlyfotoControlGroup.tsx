// No hover-to-preview footprint as LiDAR has: the archive index is queried with
// `returnGeometry=false`, so there is no outline to paint.

import { Menu, ScrollArea, SegmentedControl, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { FlyfotoProject } from '../map/layers/config/backgroundLayers/flyfotoProjects';
import { ControlChip } from '../ui/ControlChip';
import { Icon } from '../ui/Icon';
import { eraLabel, FLYFOTO_ERAS, type FlyfotoEra } from './eras';
import type { FlyfotoControls } from './useFlyfotoControls';

const projectFacts = (p: FlyfotoProject): string =>
  [
    p.year != null ? String(p.year) : null,
    p.metresPerPx != null ? `${p.metresPerPx} m/px` : null,
  ]
    .filter(Boolean)
    .join(' · ');

// The project name carries only the year, so two flights over one town in one
// year are told apart by `photoDate`.
const projectMeta = (p: FlyfotoProject): string =>
  [
    p.photoDate ?? (p.year != null ? String(p.year) : null),
    p.metresPerPx != null ? `${p.metresPerPx} m/px` : null,
  ]
    .filter(Boolean)
    .join(' · ');

export const FlyfotoControlGroup = ({
  flyfoto,
}: {
  flyfoto: FlyfotoControls;
}) => {
  const { t } = useTranslation();
  const {
    isMosaic,
    isProject,
    activeProject,
    viewport,
    projects,
    era,
    setEra,
    eraCounts,
    activateMosaic,
    activateProject,
  } = flyfoto;

  const flight = isProject ? activeProject : null;
  const label = flight
    ? projectFacts(flight) || flight.projectName
    : t('flyfotoControls.mosaicShort');
  const title = flight
    ? `${flight.projectName} · ${projectMeta(flight)}`
    : `${t('flyfotoControls.mosaic')} · ${t('flyfotoControls.mosaicHint')}`;

  const status = () => {
    if (viewport.status === 'loading' || viewport.status === 'idle') {
      return <Menu.Item disabled>{t('flyfotoControls.loading')}</Menu.Item>;
    }
    if (viewport.status === 'zoomedOut') {
      return (
        <Menu.Item disabled leftSection={<Icon icon="zoom_in" size={18} />}>
          {t('flyfotoControls.zoomedOut')}
        </Menu.Item>
      );
    }
    if (viewport.status === 'error') {
      return (
        <Menu.Item disabled leftSection={<Icon icon="warning" size={18} />}>
          {t('flyfotoControls.error')}
        </Menu.Item>
      );
    }
    if (projects.length === 0) {
      return (
        <Menu.Item disabled>
          {viewport.projects.length === 0
            ? t('flyfotoControls.empty')
            : t('flyfotoControls.emptyEra')}
        </Menu.Item>
      );
    }
    return null;
  };

  return (
    <Menu width={360}>
      <Menu.Target>
        <ControlChip
          icon={flight ? 'photo_camera' : 'auto_awesome_mosaic'}
          label={label}
          title={title}
          aria-label={title}
        />
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          onClick={activateMosaic}
          leftSection={<Icon icon="auto_awesome_mosaic" size={18} />}
          rightSection={isMosaic ? <Icon icon="check" size={18} /> : undefined}
        >
          <Text size="sm">{t('flyfotoControls.mosaic')}</Text>
          <Text size="xs" c="dimmed">
            {t('flyfotoControls.mosaicHint')}
          </Text>
        </Menu.Item>

        <Menu.Divider />
        <Menu.Label>{t('flyfotoControls.projectsLabel')}</Menu.Label>

        {viewport.projects.length > 0 && (
          <SegmentedControl
            fullWidth
            size="xs"
            mx="xs"
            mb={4}
            aria-label={t('flyfotoControls.eraAria')}
            value={era}
            onChange={(value) => setEra(value as FlyfotoEra)}
            data={[
              { value: 'all', label: t('flyfotoControls.eraAll') },
              ...FLYFOTO_ERAS.map((e) => ({
                value: e.id,
                label: eraLabel(e),
                disabled: eraCounts[e.id] === 0,
              })),
            ]}
          />
        )}

        <ScrollArea.Autosize mah={340} type="scroll">
          {status()}
          {projects.map((p) => (
            <Menu.Item
              key={p.id}
              onClick={() => activateProject(p)}
              leftSection={<Icon icon="photo_camera" size={18} />}
              rightSection={
                isProject && activeProject?.id === p.id ? (
                  <Icon icon="check" size={18} />
                ) : undefined
              }
            >
              <Text size="sm">{p.projectName}</Text>
              <Text size="xs" c="dimmed">
                {projectMeta(p)}
              </Text>
            </Menu.Item>
          ))}
        </ScrollArea.Autosize>
      </Menu.Dropdown>
    </Menu>
  );
};
