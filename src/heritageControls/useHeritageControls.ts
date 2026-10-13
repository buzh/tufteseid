

import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
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
import { sketchSessionAtom } from '../sketch/session';
import { TYPING_SURFACE } from '../ui/hints';

const TOGGLE_KEY = 'k';

export const useHeritageControls = () => {
  const map = useAtomValue(mapAtom);
  const [sources, setSources] = useAtom(activeThemeLayersAtom);
  const [hidden, setHidden] = useAtom(heritageHiddenAtom);
  const [details, setDetails] = useAtom(heritageDetailsAtom);
  const [render, setRender] = useAtom(heritageRenderAtom);
  const [opacity, setOpacity] = useAtom(heritageOpacityAtom);

  const shown = !hidden && sources.size > 0;
  const sitesShown = sources.has(RESHAPEABLE_THEME_LAYER);

  const toggleShown = useCallback(() => {

    if (sources.size === 0) {
      setSources(new Set([RESHAPEABLE_THEME_LAYER]));
      setHidden(false);
      return;
    }
    setHidden(!hidden);
  }, [sources, hidden, setSources, setHidden]);

  const penHasTheMap = useAtomValue(sketchSessionAtom) !== null;
  useEffect(() => {
    if (penHasTheMap) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== TOGGLE_KEY) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(TYPING_SURFACE)) return;
      toggleShown();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [penHasTheMap, toggleShown]);

  const toggleSource = (id: ThemeLayerName) => {
    setSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

  const floor = Math.min(
    ...Array.from(sources, (id) => themeLayerMinZoom(id) ?? -Infinity),
  );
  const tooFarOut = shown && zoom !== null && zoom <= floor;

  return {
    shown,
    toggleShown,
    sources,
    toggleSource,

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
