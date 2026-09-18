import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Terrain.module.css';
import type { TerrainAnalysis } from './useTerrainAnalysis';

// Only the sliders the current visualization uses are rendered — absent rather
// than disabled, so the group is two controls wide for sky-view factor and four
// for a hillshade.
export const TerrainSliders = ({ terrain }: { terrain: TerrainAnalysis }) => {
  const { t } = useTranslation();
  const { dem, loading, vis, radiusLimits } = terrain;

  if (!dem || loading) return null;

  // VAT is in neither list although it contains a hillshade and a slope: its
  // sun and exaggeration are frozen (VAT_PRESETS in shade.ts) so two VAT
  // renders stay comparable, and a knob here would break that silently.
  const sunDependent = vis === 'hillshade';
  const usesZFactor =
    vis === 'hillshade' || vis === 'multiHillshade' || vis === 'slope';

  return (
    <div
      className={styles.sliders}
      role="group"
      aria-label={t('localities.terrain.lightLabel')}
    >
      {sunDependent && (
        <SliderRow
          label={t('localities.terrain.azimuth')}
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
          label={t('localities.terrain.altitude')}
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
          label={t('localities.terrain.zFactor')}
          value={terrain.zFactor}
          min={1}
          max={8}
          step={0.5}
          suffix="×"
          onChange={terrain.setZFactor}
        />
      )}
      {/* One control over two quantities: LRM's smoothing distance and the
          horizon search distance. Keyed on vis and ceiling — the only two ways
          the value moves without the slider moving — but never on the value,
          which would remount on every commit and drop focus mid arrow-key.
          Deferred for the horizon views, whose scan is ~800 ms a pass. */}
      {radiusLimits && (
        <SliderRow
          key={`${vis}-${radiusLimits.max}`}
          label={t(
            vis === 'lrm'
              ? 'localities.terrain.lrmRadius'
              : 'localities.terrain.svfRadius',
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
      {/* Counted as transparency — 0 % is fully covering — while the hook
          holds opacity, which is what OpenLayers wants. */}
      <SliderRow
        label={t('localities.terrain.transparency')}
        value={100 - terrain.opacity}
        min={0}
        max={100}
        step={5}
        suffix="%"
        onChange={(v) => terrain.setOpacity(100 - v)}
      />
    </div>
  );
};

// Label, track and readout on one line, so these fit the settings strip. A
// plain range input, streaming its value; safe from W/S cycling because
// useBackgroundCyclingKeys bails on INPUT targets. With `deferred` the thumb
// and readout still track the drag but the caller only hears about it on
// release.
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
  onChange: (v: number) => void;
}) => {
  // Only read while deferred; the caller keys this component on whatever the
  // value belongs to, so there is no external change for the draft to miss.
  const [draft, setDraft] = useState(value);
  const shown = deferred ? draft : value;
  const commit = () => {
    if (draft !== value) onChange(draft);
  };

  return (
    <div className={styles.slider}>
      <span className={styles.sliderLabel}>{label}</span>
      <input
        type="range"
        // The label is a sibling span, not a `<label for>`.
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (deferred) setDraft(next);
          else onChange(next);
        }}
        // Pointer and keyboard both: arrow keys move a focused range input,
        // and blur catches a drag that ended off the control.
        onPointerUp={deferred ? commit : undefined}
        onKeyUp={deferred ? commit : undefined}
        onBlur={deferred ? commit : undefined}
      />
      <span className={styles.sliderValue}>
        {shown}
        {suffix}
      </span>
    </div>
  );
};
