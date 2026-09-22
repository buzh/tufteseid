// The Kulturminner overlay's controller: whether the heritage record is drawn
// over the ground, and what of it.
//
// Not an arm. The registers go over LiDAR relief, Kartverket's cartography and
// ortofoto alike, so this belongs to the tool end of the band and is mounted
// once — and unlike every ground atom, none of the four it drives is a
// `halved()` pair, so a split view would draw the same overlay on both sides
// until they are.
//
// Four axes, and the band's button is not one of them. `activeThemeLayersAtom`
// is which of the five RA services are ticked and `heritageHiddenAtom` a blind
// over all of them at once; on/off is the product of the two, which is what
// lets the blind keep the ticks across an off and back on. The other two
// reshape the one service whose WMS request can be reshaped — the registers
// inside kulturminner2 and the style its sublayers are drawn in, both resolved
// against RA's tables in `map/layers/heritage.ts`.

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

  // On the map, as against ticked: the blind is the difference.
  const shown = !hidden && sources.size > 0;
  const sitesShown = sources.has(RESHAPEABLE_THEME_LAYER);

  const toggleShown = () => {
    // With nothing ticked the button arms the overlay rather than raising a
    // blind over an empty selection, so reaching the heritage record is one
    // press on the control named after it.
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
    // The blind is over every source at once, so ticking one has to raise it or
    // the checkbox answers with nothing on the map. Outside the updater: a
    // setter is not a place for a side effect.
    if (!sources.has(id)) setHidden(false);
  };

  const toggleDetail = (detail: HeritageDetail) =>
    setDetails((prev) => {
      const next = new Set(prev);
      if (next.has(detail)) next.delete(detail);
      else next.add(detail);
      return next;
    });

  // Fractional, and a pan leaves it alone, so this settles after a zoom rather
  // than re-rendering the row behind every drag.
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

  // Every RA service here is capped below city scale — 300 000 records is an
  // unreadable wall of pins — so the overlay can be on and drawing nothing at
  // all. The floor is the lowest of the ticked sources': one that draws is
  // enough for the map not to be blank.
  const floor = Math.min(
    ...Array.from(sources, (id) => themeLayerMinZoom(id) ?? -Infinity),
  );
  const tooFarOut = shown && zoom !== null && zoom <= floor;

  return {
    shown,
    toggleShown,
    /** The ticked services, blind or no blind. */
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
