// The top band, and nothing that stands in it. It answers one question — what
// is on the screen — and it is laid out in sections, each with its own subject
// and its own file:
//
// | Section | Holds | Is about |
// | --- | --- | --- |
// | `GroundSection` | the ground switch and the arm belonging to it | what is drawn under everything |
// | `ViewSection` | the view: one ground, the curtain, or the split | how the map is being looked at |
// | `ToolSection` | the Kulturminner overlay, the upstream fault chip | what applies whichever ground is up |
//
// The split is by subject, not by position: a control belongs to the left
// because it chooses the one picture the whole map is made of, to the middle
// because it changes how that picture is presented rather than which one it is,
// and to the right because it is true of all three grounds at once. Reaching
// for the section a new control belongs in should be a question about the
// control, never about where there is room.
//
// The ground section is the one that appears twice. A two-ground view mounts a
// second immediately right of the view control, so the row reads left to right
// as the screen does: the left half's ground, the view that put them both up,
// the right half's ground.
//
// The band is three columns and the view has the middle one, so it sits on the
// centre line of the row whatever the sections beside it are carrying — it is
// the one control the reader can go back to without looking. That is why the
// two side tracks are wrappers rather than the sections themselves: the right
// one carries both the B section and the tools, and a grid needs exactly three
// children to have a middle.

import { useAtomValue } from 'jotai';
import { compareOnAtom } from '../map/compare/halves';
import { GroundSection } from './GroundSection';
import styles from './Ribbon.module.css';
import { ToolSection } from './ToolSection';
import { ViewSection } from './ViewSection';

export const Ribbon = () => {
  const twoGrounds = useAtomValue(compareOnAtom);

  return (
    <header className={styles.ribbon}>
      <div className={styles.side}>
        <GroundSection half="a" />
      </div>
      <ViewSection />
      <div className={styles.side}>
        {twoGrounds && <GroundSection half="b" />}
        <ToolSection />
      </div>
    </header>
  );
};
