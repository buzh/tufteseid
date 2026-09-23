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

// The atom holds opacity, as the WMS layers and `?heritageOpacity` do; the
// slider is transparency, so the opacity floor is the track's ceiling.
const MAX_TRANSPARENCY = Math.round(100 - MIN_HERITAGE_OPACITY * 100);

export const HeritageMenu = ({ heritage }: { heritage: HeritageControls }) => {
  const { t, i18n } = useTranslation();
  const {
    shown,
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
  // The render is a property of kulturminner2 alone.
  const title = [
    !shown
      ? t('heritageControls.chipHiddenTitle')
      : sitesShown
        ? t('heritageControls.chipTitle', {
            sources: names.join(', '),
            render: t(`heritageControls.render.${render}`),
          })
        : t('heritageControls.chipSourcesTitle', { sources: names.join(', ') }),
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
          warn={tooFarOut}
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
                {/* kulturminner2's three registers are sublayers of one
                    request, so ticking one does not put the source on the map. */}
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
                {/* WMS takes a single STYLES value per LAYERS entry, so render
                    and subset are seven radio rows rather than two axes. */}
                <Radio.Group
                  value={render}
                  onChange={(value) => setRender(value as HeritageRender)}
                  label={t('heritageControls.renderHead')}
                  // The group's label is an `Input.Label`: md and semibold
                  // unless it is told otherwise.
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
