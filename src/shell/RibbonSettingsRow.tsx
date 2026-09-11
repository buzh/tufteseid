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
import { StandardVariantPicker } from './standard/StandardVariantPicker';
import type { StandardControls } from './standard/useStandardControls';
import { TerrainStrip } from './terrain/TerrainStrip';
import type { TerrainAnalysis } from './terrain/useTerrainAnalysis';
import type { GroundControls, GroundMode } from './useGroundMode';

/**
 * What to call the thing being adjusted. Keyed on the ground *mode* rather
 * than on which family of controls is below it: in Hybrid the controls are
 * the LiDAR stack's, but the person reading the map is reading Hybrid, and
 * labelling the strip "LiDAR" there would describe the plumbing instead.
 *
 * Exhaustive over GroundMode, so adding a sixth ground is a type error here
 * rather than an unlabelled bar.
 */
const SUBJECT_KEY: Record<GroundMode, string> = {
  standard: 'ribbon.mode.standard',
  lidar: 'ribbon.mode.lidar',
  hybrid: 'ribbon.mode.hybrid',
  flyfoto: 'ribbon.mode.flyfoto',
  terreng: 'ribbon.terrain.label',
};

/**
 * The settings strip — one line under row 1, holding the controls that belong
 * to whatever row 1 currently has selected.
 *
 * A *strip*, not a tray. The four-row collapse deleted a 380 px panel and a
 * pair of tool rows that between them grew the bar to five hundred pixels,
 * over the very terrain they were describing; the rule that came out of that
 * forbids **bodies, not rows**. So the contract here is one line. Anything
 * needing more goes in a popover anchored to a control on this line, the way
 * the dataset pickers already do — a subject whose controls stop fitting is
 * the signal to move something into a popover, never to let the strip grow.
 *
 * Two different questions decide what it shows, and keeping them apart is the
 * whole point of the split introduced in fb4104c:
 *
 * - `ground.modifiers` picks the **controls**, because they act on a stack,
 *   and Hybrid is a modifier on the LiDAR stack rather than a stack of its
 *   own.
 * - `ground.mode` picks the **label**, because that is the ground actually on
 *   screen.
 *
 * Always present. It used to disappear under Standard, which had nothing to
 * adjust; now that Standard is five cartographies the strip is a fixture, and
 * that is the better shape anyway — a line of chrome that comes and goes as
 * you walk the ring makes the whole bar change height under the pointer, and
 * every control below row 1 move.
 *
 * Terreng is the one subject that can *wrap* this line, because it is the one
 * that puts sliders on it (`TerrainSliders`, inline: label · track · readout).
 * That is within the contract, which forbids a *body* — the 380 px panel, the
 * 360 px dock column — rather than a second line of the same thin row; and
 * the knobs had a dedicated second row until they were flattened, so wrapping
 * on a narrow window costs exactly what that row cost on every window. If a
 * ninth visualization ever needs a fifth slider, the answer is fewer knobs on
 * the line, not a taller strip.
 *
 * With the compare curtain up the strip also carries the A|B switch, and both
 * questions above are then asked of the *focused* half — the controls on this
 * line and the five buttons on the row above act on whichever side of the
 * curtain the switch names (docs/ui-architecture.md §5.8).
 *
 * Deliberately *not* registered with `anyOverlayOpenAtom`. The strip is
 * ordinary chrome, not an overlay, and counting it as one would disable 1–5
 * and W/S/A/D exactly while someone is using the controls that those keys are
 * the shortcut for.
 */
export const RibbonSettingsRow = ({
  ground,
  standard,
  lidar,
  flyfoto,
  terrain,
}: {
  ground: GroundControls;
  standard: StandardControls;
  lidar: LidarControls;
  flyfoto: FlyfotoControls;
  terrain: TerrainAnalysis;
}) => {
  const { t } = useTranslation();
  const compareOn = useAtomValue(compareOnAtom);
  const [focus, setFocus] = useAtom(compareFocusAtom);

  const subject = t(SUBJECT_KEY[ground.mode]);

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
      {/* First, ahead of the subject, because it governs what the subject
          even names: "Høyre — Flyfoto" is one phrase read left to right. */}
      {compareOn && (
        <Segmented
          value={focus}
          options={halfOptions}
          onChange={setFocus}
          label={t('ribbon.compare.halfLabel')}
        />
      )}

      <span className={styles.settingsSubject}>{subject}</span>

      {ground.modifiers === 'standard' && (
        <div className={styles.group}>
          <StandardVariantPicker standard={standard} />
        </div>
      )}

      {ground.modifiers === 'flyfoto' && (
        <div className={styles.group}>
          <FlyfotoDatasetPicker flyfoto={flyfoto} />
          {/* Narrows the pulldown beside it and the W/S ring together, so
              the chips are next to the chip whose count they change. */}
          <FlyfotoEraPicker flyfoto={flyfoto} />
        </div>
      )}

      {ground.modifiers === 'lidar' && (
        <div className={styles.group}>
          <LidarDatasetPicker lidar={lidar} />
          {/* Only when the dataset publishes more than one styled variant. */}
          {lidar.datasetStyles.length > 1 && <LidarStylePicker lidar={lidar} />}
          {/* Outside that guard on purpose: DOM publishes a single style, so
              the style chip disappears in DOM mode and this toggle would take
              the way back out with it. */}
          <LidarModelToggle
            model={lidar.lidarModel}
            onSelect={lidar.setLidarModel}
          />
          {/* Keyed on the *mode*, not the modifiers, and the only control on
              this strip that is: contours are two more groups in the hybrid
              overlay's own request, so in plain LiDAR there is no overlay for
              them to ride on and the switch would toggle nothing. */}
          {ground.mode === 'hybrid' && (
            <HybridContoursToggle
              contours={lidar.hybridContours}
              onChange={lidar.setHybridContours}
            />
          )}
        </div>
      )}

      {/* Not wrapped in a `group` like the two above: Terreng brings the most
          controls of any subject — five long Norwegian visualization names,
          a model toggle, a readout and two verbs — and holding them together
          on one unbreakable line is what would push the strip off a laptop.
          It supplies its own grouping for the pairs that must not split. */}
      {ground.modifiers === 'terrain' && <TerrainStrip terrain={terrain} />}
    </div>
  );
};
