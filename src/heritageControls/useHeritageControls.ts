// On/off is the product of `activeThemeLayersAtom` (the ticked RA services) and
// `heritageHiddenAtom` (a blind over all of them), so the ticks survive an off.

import { useAtom, useAtomValue } from 'jotai';
import { useEffect, useState } from 'react';
import { mapAtom } from '../map/atoms';
import {
  activeThemeLayersAtom,
  RESHAPEABLE_THEME_LAYER,
} from '../map/layers/atoms';
import {
  type HeritageDetail,
  heritageDetailsAtom,
  heritageHiddenAtom,
  heritageOpacityAtom,
  heritageRenderAtom,
} from '../map/layers/heritage';
import { themeLayerMinZoom } from '../map/layers/themeLayerConfigApi';
import type { ThemeLayerName } from '../map/layers/themeWMS';

export const useHeritageControls = () => {
  const map = useAtomValue(mapAtom);
  const [sources, setSources] = useAtom(activeThemeLayersAtom);
  const [hidden, setHidden] = useAtom(heritageHiddenAtom);
  const [details, setDetails] = useAtom(heritageDetailsAtom);
  const [render, setRender] = useAtom(heritageRenderAtom);
  const [opacity, setOpacity] = useAtom(heritageOpacityAtom);

  const shown = !hidden && sources.size > 0;
  const sitesShown = sources.has(RESHAPEABLE_THEME_LAYER);

  const toggleShown = () => {
    // With nothing ticked, arm the overlay rather than raise a blind over an
    // empty selection.
    if (sources.size === 0) {
      setSources(new Set([RESHAPEABLE_THEME_LAYER]));
      setHidden(false);
      return;
    }
    setHidden(!hidden);
  };

  const toggleSource = (id: ThemeLayerName) => {
    setSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // The blind covers every source at once, so ticking one has to raise it.
    if (!sources.has(id)) setHidden(false);
  };

  const toggleDetail = (detail: HeritageDetail) =>
    setDetails((prev) => {
      const next = new Set(prev);
      if (next.has(detail)) next.delete(detail);
      else next.add(detail);
      return next;
    });

  const [zoom, setZoom] = useState<number | null>(
    () => map.getView().getZoom() ?? null,
  );
  useEffect(() => {
    const read = () => setZoom(map.getView().getZoom() ?? null);
    read();
    map.on('moveend', read);
    return () => {
      map.un('moveend', read);
    };
  }, [map]);

  // Every RA service is capped below city scale, so the overlay can be on and
  // drawing nothing. The floor is the lowest of the ticked sources'.
  const floor = Math.min(
    ...Array.from(sources, (id) => themeLayerMinZoom(id) ?? -Infinity),
  );
  const tooFarOut = shown && zoom !== null && zoom <= floor;

  return {
    shown,
    toggleShown,
    sources,
    toggleSource,
    /** kulturminner2 is ticked, so its registers and renders are on offer. */
    sitesShown,
    details,
    toggleDetail,
    render,
    setRender,
    opacity,
    setOpacity,
    tooFarOut,
  };
};

export type HeritageControls = ReturnType<typeof useHeritageControls>;
