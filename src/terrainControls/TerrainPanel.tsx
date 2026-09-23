import {
  Button,
  Divider,
  Select,
  Slider,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_SIDE_M } from '../map/bbox';
import type { Visualization } from '../terrain/shade';
import { ControlButton } from '../ui/ControlButton';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import styles from './TerrainPanel.module.css';
import type { TerrainControls } from './useTerrainControls';

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
    adjusting,
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

  // The capped wording needs 5 % slack: inside `MAX_SIDE_M` the grid is exact.
  const status = adjusting
    ? t('terrainControls.placing', { side: sideMetres })
    : loading
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

  // VAT holds a hillshade and a slope but takes no knobs: its sun and
  // exaggeration are frozen (`VAT_PRESETS`) so two renders stay comparable.
  const sunDependent = vis === 'hillshade';
  const usesZFactor =
    vis === 'hillshade' || vis === 'multiHillshade' || vis === 'slope';
  const transparency = 100 - opacity;
  const isDom = model === 'dom';

  return (
    <Panel
      className={styles.panel}
      title={t('terrainControls.label')}
      status={status}
      onClose={terrain.close}
    >
      <Stack gap="xs">
        {adjusting ? (
          <Tooltip label={t('terrainControls.startHint')}>
            <Button
              size="xs"
              leftSection={<Icon icon="play_arrow" size={16} />}
              onClick={terrain.start}
            >
              {t('terrainControls.start')}
            </Button>
          </Tooltip>
        ) : (
          <Tooltip label={t('terrainControls.adjustHint', { max: MAX_SIDE_M })}>
            <Button
              size="xs"
              variant="default"
              leftSection={<Icon icon="crop_free" size={16} />}
              onClick={() => terrain.adjust()}
            >
              {t('terrainControls.adjust')}
            </Button>
          </Tooltip>
        )}
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

        {!adjusting && <Divider />}
        {!adjusting && sunDependent && (
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
        {!adjusting && (sunDependent || vis === 'multiHillshade') && (
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
        {!adjusting && usesZFactor && (
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
        {/* Keyed on the visualization and the ceiling, never on the value:
            that would remount the slider on every commit and drop focus. */}
        {!adjusting && radiusLimits && (
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
        {/* Transparency here — 0 % is fully covering — opacity in the
            controller, which is what OpenLayers takes. */}
        {!adjusting && (
          <SliderRow
            label={t('terrainControls.transparency')}
            value={transparency}
            min={0}
            max={100}
            step={5}
            suffix=" %"
            onChange={(value) => setOpacity(100 - value)}
          />
        )}
      </Stack>
    </Panel>
  );
};

// With `deferred` the thumb tracks the drag but the caller hears only on
// release, which keeps a multi-second recompute off every frame of it.
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
  // Read only while deferred: the caller keys this component on whatever the
  // value belongs to, so there is no outside change for the draft to miss.
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
