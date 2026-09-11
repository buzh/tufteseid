import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Terrain.module.css';
import type { TerrainAnalysis } from './useTerrainAnalysis';

/**
 * The light, the exaggeration and the opacity — inline on Terreng's settings
 * strip, between the model toggle and the resolution readout.
 *
 * They had a ribbon row of their own, and that row was two lines tall: each
 * slider stacked its label over its track, which doubles the height of
 * whatever it is on, and this is chrome over the terrain it is describing.
 * Laid out as label · track · readout they fit the strip's own 40 px line, so
 * Terreng now costs what every other ground costs. On a narrow window the
 * strip wraps to two lines — which is exactly what the dedicated row spent
 * unconditionally, on every window.
 *
 * On the strip rather than in a popover, which is what the strip's contract
 * asks for anything that does not fit on its line. Sliders are the exception
 * the contract already allows for: the rule forbids *bodies* — the 380 px
 * panel and the dock column — not controls on the line. And these have to stay
 * visible while they are being dragged, because what you are watching is the
 * terrain, not the control: sweeping the azimuth to see which bumps stay lit
 * is the single most useful thing the tool does, and a popover over the map is
 * the wrong half of the screen to cover while doing it.
 *
 * Only the sliders the current visualization actually uses are rendered, so
 * the group is two controls wide for sky-view factor and four for a plain
 * hillshade — which is also what keeps the strip on one line for six of the
 * eight visualizations. Absent rather than disabled: a slider that cannot move
 * is indistinguishable from one that has no effect, and the reflow reads as
 * "this view has fewer knobs".
 *
 * The radius slider is the exception to "sliders stream": it feeds the
 * expensive side of the memo split, so for sky-view factor it commits on
 * release. Local relief is 23 ms and streams like the rest.
 */
export const TerrainSliders = ({ terrain }: { terrain: TerrainAnalysis }) => {
  const { t } = useTranslation();
  const { dem, loading, vis, radiusLimits } = terrain;

  // Nothing to light until there is a DEM. The knobs are gone rather than
  // dead while it loads; the strip around them keeps the spinner.
  if (!dem || loading) return null;

  // VAT is deliberately not in either list even though it contains a hillshade
  // and a slope: its sun is frozen at 315°/35° and its exaggeration at 1×, so
  // that two VAT renders are the same picture made the same way (VAT_LAYERS in
  // shade.ts). Offering the knobs would be offering to break that quietly.
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
      {/* Two different quantities sharing one control: how far to smooth
          the DEM before subtracting it from itself (LRM), and how far to
          search for a horizon (sky-view, both opennesses, VAT). Keyed on the
          visualization and on the ceiling so the deferred draft cannot
          survive either a switch between the two or a change of grid under
          it — those are the only two ways the value can move without the
          slider moving. Not keyed on the value itself: that would remount on
          every commit and drop focus mid arrow-key.

          Deferred for everything but LRM, because everything but LRM feeds
          the horizon scan — one ~800 ms pass, so a streamed radius would
          queue one per drag frame. LRM's box blur is 23 ms and streams. */}
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
      {/* Fades the render towards whatever it is covering, which is the
          only way to check a suspected feature against the ortofoto or the
          topo map without losing the light you just dialled in. */}
      <SliderRow
        label={t('localities.terrain.opacity')}
        value={terrain.opacity}
        min={0}
        max={100}
        step={5}
        suffix="%"
        onChange={terrain.setOpacity}
      />
    </div>
  );
};

// Label, track and readout on one line, which is what lets these sit on the
// strip at all. A plain range input rather than a kit slider: this needs a
// continuous `onInput` stream to sweep the light smoothly, and the value is
// rendered beside the track anyway. Safe from W/S cycling because
// useBackgroundCyclingKeys bails on INPUT targets.
//
// `deferred` inverts that for the one knob that cannot stream: the thumb and
// the readout track the drag, but the caller only hears about it on release.
// Sky-view factor is ~800 ms a pass, so a streamed radius would queue one per
// frame and lock the tab for the length of the gesture. The readout following
// the thumb is what makes the wait legible — you can see the value you are
// about to ask for before you pay for it.
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
  // Only read while deferred. The caller keys this component on whatever the
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
        // The label is a sibling `span` rather than a `<label for>`, so the
        // input carries its own name. It had none at all while the label sat
        // in a head row above it.
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
        // Pointer *and* keyboard: arrow keys move a focused range input, and
        // blur catches a drag that ended off the control.
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
