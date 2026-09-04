import { transformExtent } from 'ol/proj';
import { useEffect, useState } from 'react';
import {
  fetchKulturminnerInBbox,
  KulturminnerResult,
} from '../api/kulturminnerWfs';
import { LocalityBbox } from '../api/localities';

// "Is this already registered?" for the open rectangle. Owned by the
// workspace rather than the section that renders it, so the count can be
// shown on the section header while the section itself is collapsed.
export const useKulturminner = (bbox: LocalityBbox) => {
  const [result, setResult] = useState<KulturminnerResult | null>(null);
  const [error, setError] = useState(false);

  const bboxKey = bbox.join(',');

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(false);
    const bbox25833 = transformExtent(bbox, 'EPSG:4326', 'EPSG:25833') as [
      number,
      number,
      number,
      number,
    ];
    fetchKulturminnerInBbox(bbox25833)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((e) => {
        console.warn('[useKulturminner] fetch failed', e);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
    // bboxKey re-fires when the rectangle is adjusted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bboxKey]);

  return { result, error };
};
