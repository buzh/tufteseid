import { useTranslation } from 'react-i18next';
import { cx } from '../ui';
import { FlyfotoDatasetPicker } from './flyfoto/FlyfotoDatasetPicker';
import type { FlyfotoControls } from './flyfoto/useFlyfotoControls';
import { LidarDatasetPicker } from './lidar/LidarDatasetPicker';
import { LidarModelToggle } from './lidar/LidarModelToggle';
import { LidarStylePicker } from './lidar/LidarStylePicker';
import type { LidarControls } from './lidar/useLidarControls';
import styles from './Ribbon.module.css';
import type { GroundControls, GroundMode } from './useGroundMode';

/**
 * What to call the thing being adjusted. Keyed on the ground *mode* rather
 * than on which family of controls is below it: in Hybrid the controls are
 * the LiDAR stack's, but the person reading the map is reading Hybrid, and
 * labelling the strip "LiDAR" there would describe the plumbing instead.
 *
 * Exhaustive over GroundMode even though Standard and Terreng never render a
 * strip, so adding a sixth ground is a type error here rather than an
 * unlabelled bar.
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
 * Absent rather than empty when there is nothing to adjust: Standard has no
 * variants, and Terreng's knobs stay in its dock panel, next to the rectangle
 * they describe. A labelled bar with no controls in it would spend map pixels
 * to say nothing.
 *
 * Deliberately *not* registered with `anyOverlayOpenAtom`. The strip is
 * ordinary chrome, not an overlay, and counting it as one would disable 1–5
 * and W/S/A/D exactly while someone is using the controls that those keys are
 * the shortcut for.
 */
export const RibbonSettingsRow = ({
  ground,
  lidar,
  flyfoto,
}: {
  ground: GroundControls;
  lidar: LidarControls;
  flyfoto: FlyfotoControls;
}) => {
  const { t } = useTranslation();

  if (ground.modifiers === null) return null;
  const subject = t(SUBJECT_KEY[ground.mode]);

  return (
    <div
      className={cx(styles.row, styles.rowSub, styles.rowSettings)}
      role="group"
      aria-label={subject}
    >
      <span className={styles.settingsSubject}>{subject}</span>

      {ground.modifiers === 'flyfoto' && (
        <div className={styles.group}>
          <FlyfotoDatasetPicker flyfoto={flyfoto} />
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
        </div>
      )}
    </div>
  );
};
