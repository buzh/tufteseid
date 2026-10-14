import { useEffect, useState } from 'react';

const FLASH_MS = 700;

export const useAutoFlash = (key: string, armed: boolean): boolean => {
  const [flashing, setFlashing] = useState(false);
  const [previous, setPrevious] = useState(key);

  if (previous !== key) {
    setPrevious(key);
    if (armed && !flashing) setFlashing(true);
  }

  useEffect(() => {
    if (!flashing) return;
    const timer = window.setTimeout(() => setFlashing(false), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flashing]);

  return flashing;
};
