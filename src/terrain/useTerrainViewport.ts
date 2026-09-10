import { toaster } from '@kvib/react';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { viewportBbox } from '../localities/createFromBbox';
import { mapAtom } from '../map/atoms';
import { terrainStandaloneBboxAtom } from './atoms';

/**
 * Row 1's "Terreng": read the ground you are looking at, with no lokalitet
 * and no sign-in. Terrain analysis is the one thing here that no WMS can
 * offer, and until now it sat four steps deep behind sign-in, creating a
 * lokalitet and opening its workspace.
 *
 * Frames the same inset viewport rectangle "Ny lokalitet" does, so the two
 * agree about what "the visible map" means — including the span guard, which
 * bites harder here: the DEM behind this is a real download rather than a
 * tile request.
 */
export const useTerrainViewport = () => {
  const { t } = useTranslation();
  const map = useAtomValue(mapAtom);
  const [bbox, setBbox] = useAtom(terrainStandaloneBboxAtom);

  const toggle = () => {
    if (bbox) {
      setBbox(null);
      return;
    }
    const result = viewportBbox(map);
    if (!result.ok) {
      toaster.error({
        title:
          result.reason === 'tooLarge'
            ? t('ribbon.terrain.tooLarge')
            : t('ribbon.terrain.unavailable'),
      });
      return;
    }
    setBbox(result.bbox);
  };

  return { active: bbox != null, toggle };
};
