// The top band, and nothing that stands in it. It answers one question — what
// is on the screen — and it is laid out in three sections, each with its own
// subject and its own file:
//
// | Section | Holds | Is about |
// | --- | --- | --- |
// | `GroundSection` | the ground switch and the arm belonging to it | what is drawn under everything |
// | `ViewSection` | the compare curtain | how the map is being looked at |
// | `ToolSection` | the Kulturminner overlay, the upstream fault chip | what applies whichever ground is up |
//
// The split is by subject, not by position: a control belongs to the left
// because it chooses the one picture the whole map is made of, to the middle
// because it changes how that picture is presented rather than which one it is,
// and to the right because it is true of all three grounds at once. Reaching
// for the section a new control belongs in should be a question about the
// control, never about where there is room.
//
// The middle section is also the slack — it grows to fill the row, so the tools
// sit at the right-hand end whether or not there is anything to centre.

import { GroundSection } from './GroundSection';
import styles from './Ribbon.module.css';
import { ToolSection } from './ToolSection';
import { ViewSection } from './ViewSection';

export const Ribbon = () => (
  <header className={styles.ribbon}>
    <GroundSection />
    <ViewSection />
    <ToolSection />
  </header>
);
