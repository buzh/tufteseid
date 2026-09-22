// What the overlay is made of, behind the chip beside the button. It appears
// only while the overlay is on: a filter over nothing is a control the reader
// has to turn something else on before it means anything.
//
// A Popover rather than a Menu. Every row in here is a setting the reader
// leaves set — five sources, three registers inside one of them, one render out
// of seven, and a transparency — and a Menu closes on the first click, which
// would make ticking two sources two trips.
//
// The chip reads out the render, because that is the thing in here that changes
// what the map looks like at a glance, and falls back to naming the sources
// when the one service the render applies to is not among them. The one thing
// it says that is not a setting is that the map is too far out for any of them
// (`useHeritageControls`): the overlay is on, the register is not empty, and
// nothing is drawn — that sentence has to be somewhere the reader sees without
// opening anything.

import {
  Checkbox,
  Divider,
  Popover,
  Radio,
  ScrollArea,
  Slider,
  Stack,
  Text,
} from '@mantine/core';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RESHAPEABLE_THEME_LAYER } from '../map/layers/atoms';
import {
  HERITAGE_DETAILS,
  HERITAGE_VERN_RENDERS,
  type HeritageRender,
  MIN_HERITAGE_OPACITY,
} from '../map/layers/heritage';
import {
  themeLayerConfig,
  themeLayerName,
} from '../map/layers/themeLayerConfigApi';
import type { ThemeLayerName } from '../map/layers/themeWMS';
import { ControlChip } from '../ui/ControlChip';
import type { HeritageControls } from './useHeritageControls';

const SOURCES = themeLayerConfig.layers.map((l) => l.id as ThemeLayerName);

// The atom holds opacity, which is what the WMS layers and `?heritageOpacity`
// take; the slider is counted as transparency, where 0 % is full strength and
// the floor under the opacity becomes the ceiling over the track.
const MAX_TRANSPARENCY = Math.round(100 - MIN_HERITAGE_OPACITY * 100);

export const HeritageMenu = ({ heritage }: { heritage: HeritageControls }) => {
  const { t, i18n } = useTranslation();
  const {
    sources,
    toggleSource,
    sitesShown,
    details,
    toggleDetail,
    render,
    setRender,
    opacity,
    setOpacity,
    tooFarOut,
  } = heritage;
  const [opened, setOpened] = useState(false);

  const names = SOURCES.filter((id) => sources.has(id)).map((id) =>
    themeLayerName(id, i18n.language),
  );
  const renderLabel = t(`heritageControls.render.${render}`);
  // The render is a property of kulturminner2 alone, so with that source off it
  // would be a readout of something nobody can see. Name what is drawing
  // instead.
  const label = sitesShown
    ? renderLabel
    : names.length === 1
      ? names[0]
      : t('heritageControls.sourceCount', { count: names.length });
  const title = [
    sitesShown
      ? t('heritageControls.chipTitle', {
          sources: names.join(', '),
          render: renderLabel,
        })
      : names.join(', '),
    tooFarOut ? t('heritageControls.zoomedOutHint') : null,
  ]
    .filter(Boolean)
    .join(' — ');

  const transparency = Math.round(100 - opacity * 100);

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={300}
      position="bottom-end"
      shadow="md"
      withinPortal
    >
      <Popover.Target>
        <ControlChip
          icon="tune"
          label={label}
          hint={tooFarOut ? t('heritageControls.zoomedOut') : undefined}
          title={title}
          aria-label={title}
          onClick={() => setOpened((o) => !o)}
        />
      </Popover.Target>
      <Popover.Dropdown>
        <ScrollArea.Autosize mah={420} type="scroll">
          <Stack gap="xs">
            <Text size="xs" c="dimmed">
              {t('heritageControls.sourcesHead')}
            </Text>

            {SOURCES.map((id) => (
              <Fragment key={id}>
                <Checkbox
                  size="xs"
                  label={themeLayerName(id, i18n.language)}
                  checked={sources.has(id)}
                  onChange={() => toggleSource(id)}
                />
                {/* kulturminner2's three registers, only while it is on: they
                    are sublayers of one request, and ticking one does not put
                    the source on the map. */}
                {id === RESHAPEABLE_THEME_LAYER && sitesShown && (
                  <Stack gap={6} ml="lg">
                    {HERITAGE_DETAILS.map((detail) => (
                      <Checkbox
                        key={detail}
                        size="xs"
                        label={t(`heritageControls.detail.${detail}`)}
                        checked={details.has(detail)}
                        onChange={() => toggleDetail(detail)}
                      />
                    ))}
                  </Stack>
                )}
              </Fragment>
            ))}

            {sitesShown && (
              <>
                <Divider />
                {/* One axis, not two: WMS takes a single STYLES value per
                    LAYERS entry, so "heldekkende" and "bare de fredede" are
                    seven radio rows rather than a render and a filter. */}
                <Radio.Group
                  value={render}
                  onChange={(value) => setRender(value as HeritageRender)}
                  label={t('heritageControls.renderHead')}
                  // The heads in here are all one size, and the group's own is
                  // an `Input.Label` — md and semibold unless it is told.
                  labelProps={{ size: 'xs', c: 'dimmed', fw: 400 }}
                >
                  <Stack gap={6} mt={6}>
                    <Radio
                      size="xs"
                      value="omriss"
                      label={t('heritageControls.render.omriss')}
                      description={t('heritageControls.omrissHint')}
                    />
                    <Radio
                      size="xs"
                      value="flate"
                      label={t('heritageControls.render.flate')}
                    />
                    <Text size="xs" c="dimmed" mt={4}>
                      {t('heritageControls.subsetHead')}
                    </Text>
                    {HERITAGE_VERN_RENDERS.map((r) => (
                      <Radio
                        key={r}
                        size="xs"
                        value={r}
                        label={t(`heritageControls.render.${r}`)}
                      />
                    ))}
                  </Stack>
                </Radio.Group>
              </>
            )}

            <Divider />
            <div>
              <Text size="xs" c="dimmed">
                {t('heritageControls.transparency', { percent: transparency })}
              </Text>
              <Slider
                size="xs"
                mt={6}
                min={0}
                max={MAX_TRANSPARENCY}
                step={5}
                value={transparency}
                onChange={(value) => setOpacity((100 - value) / 100)}
                thumbLabel={t('heritageControls.transparencyAria')}
              />
            </div>
          </Stack>
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
};
