import { useEffect, useState } from 'react';

const ARMED_MS = 5000;

export type Confirm = {
  /** The next press goes through. */
  armed: boolean;
  press: () => void;
};

/** `run` behind one confirmation; with `guard` false the press goes straight
 *  through. */
export const useConfirm = (run: () => void, guard = true): Confirm => {
  const [pressed, setPressed] = useState(false);
  const armed = pressed && guard;

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
