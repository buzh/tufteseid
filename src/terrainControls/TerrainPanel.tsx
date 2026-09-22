// What the analysis is made of, in a box floating on the map.
//
// Not a dropdown off the band. Every control in here changes a picture the
// reader is looking at while they turn it — a sun moves across relief, a radius
// opens or closes a hollow, a transparency lets the ground back through — and a
// menu that covers the map and closes on the first click makes each of those a
// round trip. The box costs a corner of the view; the fold in the header gives
// it back without dropping the grid.
//
// The eight visualizations are a pulldown rather than eight rows, because they
// are the tallest thing in here and the one setting a reader picks once. The
// list they are in is a taxonomy, not an order of preference: lit views, then
// the composite, then the views that need no light source at all. The meaning
// of whichever one is chosen is the line under it.

import {
  Button,
  Divider,
  Select,
  Slider,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_SIDE_M } from '../map/bbox';
import type { Visualization } from '../terrain/shade';
import { ControlButton } from '../ui/ControlButton';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import styles from './TerrainPanel.module.css';
import type { TerrainControls } from './useTerrainControls';

// Grouped rather than flat, and the grouping is the whole argument for the
// order: what a lit view shows depends on where you put the sun, what an unlit
// one shows does not, and VAT sits between them because it holds both and
// freezes the sun so two VAT renders stay comparable.
const VIS_GROUPS: readonly {
  key: 'lit' | 'blend' | 'unlit';
  items: readonly Visualization[];
}[] = [
  { key: 'lit', items: ['hillshade', 'multiHillshade'] },
  { key: 'blend', items: ['vat'] },
  { key: 'unlit', items: ['svf', 'openPos', 'openNeg', 'lrm', 'slope'] },
];

export const TerrainPanel = ({ terrain }: { terrain: TerrainControls }) => {
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
  const [open, setOpen] = useState(true);

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

  // VAT is in neither list although it holds a hillshade and a slope: its sun
  // and its exaggeration are frozen (`VAT_PRESETS`) so that two VAT renders of
  // different places stay comparable, and a knob here would break that without
  // saying so.
  const sunDependent = vis === 'hillshade';
  const usesZFactor =
    vis === 'hillshade' || vis === 'multiHillshade' || vis === 'slope';
  const transparency = 100 - opacity;
  const isDom = model === 'dom';

  return (
    <section className={styles.panel} aria-label={t('terrainControls.label')}>
      <UnstyledButton
        className={styles.header}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.headerText}>
          <span className={styles.title}>{t('terrainControls.label')}</span>
          {status && <span className={styles.status}>{status}</span>}
        </span>
        <Icon
          icon="keyboard_arrow_down"
          size={18}
          className={cx(styles.chevron, open && styles.chevronOpen)}
        />
      </UnstyledButton>

      {open && (
        <div className={styles.body}>
          <Stack gap="xs">
            <Divider />

            {/* The rectangle first: it is what everything under it is a
                picture of, and the one thing in here the reader has to move
                rather than set. The why is in the tooltip — it is a paragraph,
                and a paragraph pinned open in a box this size is the paragraph
                you stop reading. */}
            <Tooltip
              label={t('terrainControls.windowHint', { max: MAX_SIDE_M })}
            >
              <Button
                size="xs"
                variant="default"
                leftSection={<Icon icon="recenter" size={16} />}
                onClick={() => terrain.reframe()}
              >
                {t('terrainControls.reframe')}
              </Button>
            </Tooltip>
            {error && (
              <Text size="xs" c="orange">
                {t(`terrainControls.${error}`)}
              </Text>
            )}

            <Select
              size="xs"
              label={t('terrainControls.visHead')}
              description={t(`terrainControls.visMeta.${vis}`)}
              inputWrapperOrder={['label', 'input', 'description']}
              value={vis}
              // Deselecting would leave the box with a render on the map and
              // nothing naming it.
              allowDeselect={false}
              onChange={(value) => value && setVis(value as Visualization)}
              data={VIS_GROUPS.map(({ key, items }) => ({
                group: t(`terrainControls.visGroup.${key}`),
                items: items.map((candidate) => ({
                  value: candidate,
                  label: t(`terrainControls.vis.${candidate}`),
                })),
              }))}
            />

            {/* Bare earth against first return — the same ground with and
                without what grows on it and what is built on it. The same
                split box the LiDAR ground wears in the band, because it is the
                same choice over the same two models; here it also refetches. */}
            <div className={styles.row}>
              <span className={styles.rowLabel}>
                {t('terrainControls.modelHead')}
              </span>
              <Tooltip
                label={
                  isDom
                    ? t('terrainControls.model.toDtm')
                    : t('terrainControls.model.toDom')
                }
              >
                <ControlButton
                  split={['park', 'landscape']}
                  lit={isDom ? 'upper' : 'lower'}
                  aria-label={t('terrainControls.model.aria', {
                    model: isDom
                      ? t('terrainControls.model.dom')
                      : t('terrainControls.model.dtm'),
                  })}
                  aria-pressed={isDom}
                  onClick={() => setModel(isDom ? 'dtm' : 'dom')}
                />
              </Tooltip>
            </div>

            {/* Only the sliders this visualization reads, absent rather than
                disabled: two tracks for sky-view factor, four for a
                hillshade, one for VAT. */}
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
        </div>
      )}
    </section>
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
