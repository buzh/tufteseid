import { useTranslation } from 'react-i18next';
import { Segmented, type SegmentedOption } from '../../ui';
import { eraLabel, FLYFOTO_ERAS, type FlyfotoEra } from './eras';
import type { FlyfotoControls } from './useFlyfotoControls';

/**
 * Which period of the ortofoto archive the acquisition list is narrowed to.
 *
 * On the strip rather than inside the acquisition pulldown, which is where a
 * filter would normally go (the LiDAR one is): the periods are the thing you
 * set first here, and in a town the pulldown has a hundred rows in it — a
 * filter you have to open the hundred-row list to reach has the order
 * backwards. Four chips and "Alle" is also small enough to sit on one line
 * beside the chip it filters, which the strip's contract requires.
 *
 * A period with nothing in this viewport is disabled rather than hidden, so
 * the row does not reflow under the pointer while panning — and so "there are
 * no pre-war flights here" is answerable without clicking. The selected one
 * is never disabled even when it empties out, or a pan could strand the user
 * on a filter with no way back to a neighbouring period.
 */
export const FlyfotoEraPicker = ({ flyfoto }: { flyfoto: FlyfotoControls }) => {
  const { t } = useTranslation();
  const { era, eraCounts, viewport } = flyfoto;

  // Only once the query has answered. While it is in flight the counts are
  // the previous view's, and greying out a period the user is about to have
  // is worse than briefly offering one they do not.
  const known = viewport.status === 'ready';

  const options: SegmentedOption<FlyfotoEra>[] = [
    { value: 'all', label: t('ribbon.flyfoto.eraAll') },
    ...FLYFOTO_ERAS.map((e) => ({
      value: e.id,
      label: eraLabel(e),
      disabled: known && eraCounts[e.id] === 0 && era !== e.id,
    })),
  ];

  return (
    <Segmented
      value={era}
      options={options}
      onChange={flyfoto.setEra}
      label={t('ribbon.flyfoto.eraLabel')}
    />
  );
};
