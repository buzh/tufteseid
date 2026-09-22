// The Flyfoto arm: one chip, the same shape as the LiDAR dataset menu, because
// it answers the same question — the seamless product, or one flight over this
// place.
//
// The period filter is inside the dropdown rather than beside the chip. It is
// not a thing that is showing: it narrows the list the reader is already
// looking at, and a chip in the band for it would say something about the map
// that is not true of the map. It appears only once there is a list to narrow.
//
// No hover-to-preview footprint as LiDAR has: the archive index is queried with
// `returnGeometry=false`, so there is no outline to paint.

import { Menu, ScrollArea, SegmentedControl, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { FlyfotoProject } from '../map/layers/config/backgroundLayers/flyfotoProjects';
import { ControlChip } from '../ui/ControlChip';
import { Icon } from '../ui/Icon';
import { eraLabel, FLYFOTO_ERAS, type FlyfotoEra } from './eras';
import type { FlyfotoControls } from './useFlyfotoControls';

/** "2023 · 0.1 m/px", the two facts that rank one flight against another. */
const projectFacts = (p: FlyfotoProject): string =>
  [
    p.year != null ? String(p.year) : null,
    p.metresPerPx != null ? `${p.metresPerPx} m/px` : null,
  ]
    .filter(Boolean)
    .join(' · ');

// The exact date where the archive has one: the project name carries only the
// year, so two flights over the same town in one year look identical without it.
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

  // The year and the resolution, not the project name: the name is where the
  // reader already is, and the two facts that rank one flight against another
  // are what the chip is being read for. The name is a hover away in `title`.
  const flight = isProject ? activeProject : null;
  const label = flight
    ? projectFacts(flight) || flight.projectName
    : t('flyfotoControls.mosaicShort');
  const title = flight
    ? `${flight.projectName} · ${projectMeta(flight)}`
    : `${t('flyfotoControls.mosaic')} · ${t('flyfotoControls.mosaicHint')}`;

  const status = () => {
    if (viewport.status === 'loading' || viewport.status === 'idle') {
      return (
        <Menu.Item disabled>{t('flyfotoControls.loading')}</Menu.Item>
      );
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
          {/* Never flown here, or not in the chosen period — the second is one
              click from being undone, so say which. */}
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
        {/* The mosaic is not a flight: it is every flight cut together and kept
            current, so it keeps the mosaic glyph while an acquisition gets the
            camera. */}
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

        {/* Only once the viewport has something to narrow: a row of dead
            periods over an empty list says nothing the empty list does not. */}
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
