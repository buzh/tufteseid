// What the analysis is made of, behind the chip joined to the button. It
// appears only while the analysis is running: with no rectangle there is no
// grid, no resolution to report and no radius ceiling to offer, and a menu of
// knobs over nothing is a control the reader has to turn something else on
// before it means anything.
//
// No glyph on the chip. It shares a box with the toggle that turned the
// analysis on, and a second glyph an eighth of an inch from that one would read
// as a second subject; the chevron already says the chip opens.
//
// A Popover rather than a Menu. Everything in here is a setting the reader
// leaves set — one visualization out of eight, a height model, a sun, a radius
// and a transparency — and a Menu closes on the first click, which would make
// lighting a hillshade one trip per degree.
//
// The chip reads out the visualization, because that is what the picture on the
// map is, and carries the state of the fetch as its hint: a DEM is megabytes
// over a slow origin, and "nothing has appeared yet" has to be answerable
// without opening anything. The rectangle's size is in the same line for the
// same reason — it is the one number that says how much ground the reader is
// actually reading, and it is capped rather than chosen.

import {
  Button,
  Divider,
  Popover,
  Radio,
  ScrollArea,
  SegmentedControl,
  Slider,
  Stack,
  Text,
} from '@mantine/core';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_SIDE_M } from '../map/bbox';
import type { DemModel } from '../terrain/dem';
import { ControlChip } from '../ui/ControlChip';
import { Icon } from '../ui/Icon';
import { VISUALIZATIONS, type TerrainControls } from './useTerrainControls';

const MODELS: DemModel[] = ['dtm', 'dom'];

export const TerrainMenu = ({ terrain }: { terrain: TerrainControls }) => {
  const { t } = useTranslation();
  const {
    vis,
    setVis,
    model,
    setModel,
    dem,
    loading,
    error,
    sideMetres,
    radiusLimits,
    opacity,
    setOpacity,
  } = terrain;
  const [opened, setOpened] = useState(false);

  const visLabel = t(`terrainControls.vis.${vis}`);

  // Three states in one line, in the order they happen: the fetch, what it
  // found, and — the usual case — what is on the map. The capped wording is
  // the only one of the two resolutions that is actionable, and on a rectangle
  // inside the cap it can never appear, since the grid is exact there by
  // construction.
  const status = loading
    ? t('terrainControls.loading')
    : error
      ? t(`terrainControls.${error}Short`)
      : dem
        ? t(
            dem.metresPerPx > dem.nativeMetresPerPx * 1.05
              ? 'terrainControls.resolutionCapped'
              : 'terrainControls.resolution',
            {
              side: sideMetres,
              m: dem.metresPerPx.toFixed(2),
              src: dem.nativeMetresPerPx.toFixed(2),
            },
          )
        : undefined;

  const title = [visLabel, t(`terrainControls.model.${model}`), status]
    .filter(Boolean)
    .join(' — ');

  // VAT is in neither list although it holds a hillshade and a slope: its sun
  // and its exaggeration are frozen (`VAT_PRESETS`) so that two VAT renders of
  // different places stay comparable, and a knob here would break that without
  // saying so.
  const sunDependent = vis === 'hillshade';
  const usesZFactor =
    vis === 'hillshade' || vis === 'multiHillshade' || vis === 'slope';
  const transparency = 100 - opacity;

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={320}
      position="bottom-end"
      shadow="md"
      withinPortal
    >
      <Popover.Target>
        <ControlChip
          label={visLabel}
          hint={status}
          title={title}
          aria-label={title}
          onClick={() => setOpened((o) => !o)}
        />
      </Popover.Target>
      <Popover.Dropdown>
        <ScrollArea.Autosize mah={460} type="scroll">
          <Stack gap="xs">
            {/* The rectangle first: it is what everything under it is a
                picture of, and the one thing in here the reader has to move
                rather than set. */}
            <Text size="xs" c="dimmed">
              {t('terrainControls.windowHint', { max: MAX_SIDE_M })}
            </Text>
            <Button
              size="xs"
              variant="default"
              leftSection={<Icon icon="recenter" size={16} />}
              onClick={() => terrain.reframe()}
            >
              {t('terrainControls.reframe')}
            </Button>
            {error && (
              <Text size="xs" c="orange">
                {t(`terrainControls.${error}`)}
              </Text>
            )}

            <Divider />

            <Radio.Group
              value={vis}
              onChange={(value) => setVis(value as typeof vis)}
              label={t('terrainControls.visHead')}
              // The heads in here are all one size, and a group's own is an
              // `Input.Label` — md and semibold unless it is told.
              labelProps={{ size: 'xs', c: 'dimmed', fw: 400 }}
            >
              <Stack gap={6} mt={6}>
                {VISUALIZATIONS.map((candidate) => (
                  <Fragment key={candidate}>
                    {/* The composite, and then the views that need no sun at
                        all. */}
                    {(candidate === 'vat' || candidate === 'svf') && (
                      <Text size="xs" c="dimmed" mt={4}>
                        {t(`terrainControls.visGroup.${candidate}`)}
                      </Text>
                    )}
                    <Radio
                      size="xs"
                      value={candidate}
                      label={t(`terrainControls.vis.${candidate}`)}
                      description={t(`terrainControls.visMeta.${candidate}`)}
                    />
                  </Fragment>
                ))}
              </Stack>
            </Radio.Group>

            <Divider />

            {/* Bare earth against first return — the same ground with and
                without what grows on it and what is built on it. Refetches,
                which is why it is a segment rather than a slider. */}
            <div>
              <Text size="xs" c="dimmed" mb={6}>
                {t('terrainControls.modelHead')}
              </Text>
              <SegmentedControl
                size="xs"
                fullWidth
                value={model}
                onChange={(value) => setModel(value as DemModel)}
                data={MODELS.map((m) => ({
                  value: m,
                  label: t(`terrainControls.model.${m}`),
                }))}
              />
            </div>

            {/* Only the sliders this visualization reads, absent rather than
                disabled: two controls for sky-view factor, five for a
                hillshade. */}
            <Divider />
            {sunDependent && (
              <SliderRow
                label={t('terrainControls.azimuth')}
                value={terrain.azimuth}
                min={0}
                max={359}
                step={1}
                suffix="°"
                onChange={terrain.setAzimuth}
              />
            )}
            {(sunDependent || vis === 'multiHillshade') && (
              <SliderRow
                label={t('terrainControls.altitude')}
                value={terrain.altitude}
                min={5}
                max={85}
                step={1}
                suffix="°"
                onChange={terrain.setAltitude}
              />
            )}
            {usesZFactor && (
              <SliderRow
                label={t('terrainControls.zFactor')}
                value={terrain.zFactor}
                min={1}
                max={8}
                step={0.5}
                suffix="×"
                onChange={terrain.setZFactor}
              />
            )}
            {/* One control over two quantities: LRM's smoothing distance and
                the horizon search distance. Keyed on the visualization and the
                ceiling — the only two ways the value moves without the slider
                moving — but never on the value, which would remount it on
                every commit and drop focus mid arrow-key. Deferred for the
                horizon views, whose scan is some 800 ms a pass. */}
            {radiusLimits && (
              <SliderRow
                key={`${vis}-${radiusLimits.max}`}
                label={t(
                  vis === 'lrm'
                    ? 'terrainControls.lrmRadius'
                    : 'terrainControls.svfRadius',
                )}
                value={terrain.radius}
                min={radiusLimits.min}
                max={radiusLimits.max}
                step={radiusLimits.step}
                suffix=" m"
                deferred={vis !== 'lrm'}
                onChange={terrain.setRadius}
              />
            )}
            {/* Counted as transparency — 0 % is fully covering — while the
                controller holds opacity, which is what OpenLayers wants. */}
            <SliderRow
              label={t('terrainControls.transparency')}
              value={transparency}
              min={0}
              max={100}
              step={5}
              suffix=" %"
              onChange={(value) => setOpacity(100 - value)}
            />
          </Stack>
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
};

// Heading, readout and track. With `deferred` the thumb and the heading still
// track the drag but the caller only hears about it on release, which is what
// keeps a multi-second recompute off every frame of one.
const SliderRow = ({
  label,
  value,
  min,
  max,
  step,
  suffix,
  deferred = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  deferred?: boolean;
  onChange: (value: number) => void;
}) => {
  // Only read while deferred; the caller keys this on whatever the value
  // belongs to, so there is no outside change for the draft to miss.
  const [draft, setDraft] = useState(value);
  const shown = deferred ? draft : value;

  return (
    <div>
      <Text size="xs" c="dimmed">
        {label} {shown}
        {suffix}
      </Text>
      <Slider
        size="xs"
        mt={6}
        min={min}
        max={max}
        step={step}
        value={shown}
        thumbLabel={label}
        onChange={(next) => {
          setDraft(next);
          if (!deferred) onChange(next);
        }}
        onChangeEnd={deferred ? onChange : undefined}
      />
    </div>
  );
};
