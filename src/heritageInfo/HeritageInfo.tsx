// The Kulturminner surfaces over the map: one hook doing the asking, two
// surfaces showing what came back. Mounted once, from `MapComponent`, because
// both live in OpenLayers overlays and there is nothing for them to hang off in
// the ribbon.

import { HeritagePopup } from './HeritagePopup';
import { HeritageTip } from './HeritageTip';
import { useHeritageInfo } from './useHeritageInfo';

export const HeritageInfo = () => {
  const { tip, popup, pending, closePopup } = useHeritageInfo();

  return (
    <>
      <HeritageTip reading={tip} pending={pending} />
      <HeritagePopup reading={popup} onClose={closePopup} />
    </>
  );
};
