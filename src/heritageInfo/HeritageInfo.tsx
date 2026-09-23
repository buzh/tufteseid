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
