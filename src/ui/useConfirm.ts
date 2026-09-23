// A verb that asks twice, for the two places where one click would throw
// something away: the delete in a spot card, and the close on a box with
// unsaved work in it.
//
// Two clicks on the same button rather than a dialog. These are small boxes
// floating over the map, and a modal on top of one to ask a single question is
// ceremony — the button turning red and asking again is the question, and it is
// asked where the answer is going to be clicked.

import { useEffect, useState } from 'react';

/** How long a confirm stays armed. A button left armed for the rest of the
 *  box's life turns a stray click minutes later into the thing being guarded. */
const ARMED_MS = 5000;

export type Confirm = {
  /** The next press goes through. Draw the button as the warning it is. */
  armed: boolean;
  press: () => void;
};

/**
 * `run` behind one confirmation. With `guard` false there is nothing to lose
 * and the press goes straight through, which is what lets a caller hand the
 * same button an edit state that comes and goes.
 */
export const useConfirm = (run: () => void, guard = true): Confirm => {
  const [pressed, setPressed] = useState(false);
  // Derived rather than stored, so that what was at stake going away — the
  // draft got saved, the field was emptied — disarms the button on the render
  // that reports it, with nothing to keep in step.
  const armed = pressed && guard;

  // Disarms itself rather than waiting to be disarmed: nothing else here knows
  // that the reader has moved on.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setPressed(false), ARMED_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  return {
    armed,
    press: () => {
      if (!guard) {
        run();
        return;
      }
      if (!armed) {
        setPressed(true);
        return;
      }
      setPressed(false);
      run();
    },
  };
};
