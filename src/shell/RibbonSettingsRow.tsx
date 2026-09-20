import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  type CompareHalf,
  compareFocusAtom,
  compareOnAtom,
} from '../map/compare/halves';
import { cx, Segmented, type SegmentedOption } from '../ui';
import { FlyfotoDatasetPicker } from './flyfoto/FlyfotoDatasetPicker';
import { FlyfotoEraPicker } from './flyfoto/FlyfotoEraPicker';
import type { FlyfotoControls } from './flyfoto/useFlyfotoControls';
import { HybridContoursToggle } from './lidar/HybridContoursToggle';
import { LidarDatasetPicker } from './lidar/LidarDatasetPicker';
import { LidarModelToggle } from './lidar/LidarModelToggle';
import { LidarStylePicker } from './lidar/LidarStylePicker';
import type { LidarControls } from './lidar/useLidarControls';
import styles from './Ribbon.module.css';
import { TerrainStrip } from './terrain/TerrainStrip';
import type { TerrainAnalysis } from './terrain/useTerrainAnalysis';
import type { GroundControls, GroundMode } from './useGroundMode';

/** Exhaustive over GroundMode: a sixth ground is a type error here. */
const SUBJECT_KEY: Record<GroundMode, string> = {
  kart: 'ribbon.mode.kart',
  lidar: 'ribbon.mode.lidar',
  hybrid: 'ribbon.mode.hybrid',
  flyfoto: 'ribbon.mode.flyfoto',
  terreng: 'ribbon.terrain.label',
};

/**
 * The settings strip — one line under row 1, holding whatever row 1 selected;
 * anything needing more room goes in a popover anchored to a control on it.
 * `ground.modifiers` picks the controls (Hybrid is a modifier on LiDAR's),
 * `ground.mode` picks the label, both off the focused half under the curtain.
 * Not registered with `anyOverlayOpenAtom`: counting the strip as an overlay
 * would disable 1–5 and W/S/A/D exactly while its controls are in use.
 */
export const RibbonSettingsRow = ({
  ground,
  lidar,
  flyfoto,
  terrain,
}: {
  ground: GroundControls;
  lidar: LidarControls;
  flyfoto: FlyfotoControls;
  terrain: TerrainAnalysis;
}) => {
  const { t } = useTranslation();
  const compareOn = useAtomValue(compareOnAtom);
  const [focus, setFocus] = useAtom(compareFocusAtom);

  const subject = t(SUBJECT_KEY[ground.mode]);

  // Kart's controls are on its own button, so there is nothing for this
  // row to hold — except the A|B switch, which has nowhere else to go.
  if (ground.modifiers === 'kart' && !compareOn) return null;

  const halfOptions: SegmentedOption<CompareHalf>[] = [
    { value: 'a', label: t('ribbon.compare.halfA') },
    { value: 'b', label: t('ribbon.compare.halfB') },
  ];
  const halfLabel = halfOptions.find((o) => o.value === focus)?.label ?? '';

  return (
    <div
      className={cx(styles.row, styles.rowSub, styles.rowSettings)}
      role="group"
      aria-label={compareOn ? `${halfLabel} — ${subject}` : subject}
    >
      {compareOn && (
        <Segmented
          value={focus}
          options={halfOptions}
          onChange={setFocus}
          label={t('ribbon.compare.halfLabel')}
        />
      )}

      <span className={styles.settingsSubject}>{subject}</span>

      {ground.modifiers === 'flyfoto' && (
        <div className={styles.group}>
          <FlyfotoDatasetPicker flyfoto={flyfoto} />
          <FlyfotoEraPicker flyfoto={flyfoto} />
        </div>
      )}

      {ground.modifiers === 'lidar' && (
        <div className={styles.group}>
          <LidarDatasetPicker lidar={lidar} />
          {/* Only when the ground offers more than one render — a flight's WMS
              styles, plus our cache where the store holds that flight. */}
          {lidar.datasetStyles.length > 1 && <LidarStylePicker lidar={lidar} />}
          {/* Outside that guard: DOM publishes one style, so the style chip
              disappears in DOM mode and would take this with it. */}
          <LidarModelToggle
            model={lidar.lidarModel}
            onSelect={lidar.setLidarModel}
          />
          {/* Keyed on the mode, not the modifiers: contours ride in the hybrid
              overlay's request, absent in plain LiDAR. */}
          {ground.mode === 'hybrid' && (
            <HybridContoursToggle
              contours={lidar.hybridContours}
              onChange={lidar.setHybridContours}
            />
          )}
        </div>
      )}

      {/* Not wrapped in a `group`: Terreng brings the most controls, and one
          unbreakable line would push the strip off a laptop. It groups the
          pairs that must not split itself. */}
      {ground.modifiers === 'terrain' && <TerrainStrip terrain={terrain} />}
    </div>
  );
};
