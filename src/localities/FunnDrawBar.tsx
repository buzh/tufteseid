import { useTranslation } from 'react-i18next';
import { DrawControls } from '../draw/drawControls/DrawControls';
import { Icon } from '../ui';
import styles from './FunnDrawBar.module.css';

/**
 * The pen, on the bottom edge — docs/lokalitet-view.md §6.
 *
 * This is what the dock was genuinely good at, paid for rather than waved
 * through. While you are drawing, the tools have to stay on screen *and* you
 * have to keep clicking the map; a popover closes on outside click, which is
 * every stroke you make. So the tools take the bottom slot, which the images
 * yield for the duration (§4.3) — you are not curating a gallery while the
 * pen is down.
 *
 * Tools belong near the hand, which is the other half of the argument: the
 * strip was already pinned to this edge on a phone for exactly that reason,
 * and nothing about the reason was ever mobile.
 *
 * What is *not* here is the funn's title and note. The title is a thin ribbon
 * row under the lokalitet row (`RibbonFunnDraftRow`), and the note moved out
 * of the draft entirely, into the funn popover: a textarea does not belong
 * over the map, and a note is written after you have looked at the thing
 * rather than while your hand is on the pen.
 */
export const FunnDrawBar = ({ editing }: { editing: boolean }) => {
  const { t } = useTranslation();

  return (
    <div className={styles.bar} data-chrome="bottom">
      <p className={styles.instructions}>
        <Icon icon="draw" size={16} />
        {t(
          editing
            ? 'localities.funn.draft.instructionsEdit'
            : 'localities.funn.draft.instructions',
        )}
      </p>
      <DrawControls />
    </div>
  );
};
