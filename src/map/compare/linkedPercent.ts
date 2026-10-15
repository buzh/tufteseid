import { useEffect } from 'react';
import {
  removeUrlParameter,
  setUrlParameter,
} from '../../shared/utils/urlUtils';

const URL_DEBOUNCE_MS = 400;

export const useLinkedPercent = (
  name: 'curtain' | 'blend',
  fraction: number,
  defaultPercent: number,
) => {
  useEffect(() => {
    const percent = Math.round(fraction * 100);
    const timer = window.setTimeout(() => {
      if (percent === defaultPercent) removeUrlParameter(name);
      else setUrlParameter(name, percent);
    }, URL_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [name, fraction, defaultPercent]);
};
