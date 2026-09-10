import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { viewportBbox } from '../localities/createFromBbox';
import { mapAtom } from '../map/atoms';
import { toast } from '../ui';
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

  // Also the panel's "Analyser utsnittet": with the render now sitting on the
  // map rather than in the row, panning off the analysed rectangle is a
  // normal move, and this is how you bring the analysis back to what you are
  // looking at without closing and reopening the tool.
  const frame = () => {
    const result = viewportBbox(map);
    if (!result.ok) {
      toast.error({
        title:
          result.reason === 'tooLarge'
            ? t('ribbon.terrain.tooLarge')
            : t('ribbon.terrain.unavailable'),
      });
      return;
    }
    setBbox(result.bbox);
  };

  const toggle = () => {
    if (bbox) {
      setBbox(null);
      return;
    }
    frame();
  };

  return { active: bbox != null, toggle, frame };
};
