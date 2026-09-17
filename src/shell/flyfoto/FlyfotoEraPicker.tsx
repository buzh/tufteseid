import { useTranslation } from 'react-i18next';
import { Segmented, type SegmentedOption } from '../../ui';
import { eraLabel, FLYFOTO_ERAS, type FlyfotoEra } from './eras';
import type { FlyfotoControls } from './useFlyfotoControls';

// Which period of the ortofoto archive the acquisition list is narrowed to. An
// empty period is disabled rather than hidden, so the row does not reflow under
// the pointer while panning; the selected one is never disabled, or a pan could
// strand the user on a filter with no way out.
export const FlyfotoEraPicker = ({ flyfoto }: { flyfoto: FlyfotoControls }) => {
  const { t } = useTranslation();
  const { era, eraCounts, viewport } = flyfoto;

  // Mid-query the counts are the previous view's, so nothing is greyed out yet.
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
