import { useTranslation } from 'react-i18next';
import { MAX_SIDE_M, MIN_SIDE_M } from '../localities/bboxLimits';
import { formatBboxArea, formatBboxSpan } from '../localities/format';
import type { LocalityPlacement } from '../localities/placement';
import { useLocalityPlacement } from '../localities/useLocalityPlacement';
import { Button, cx, Icon } from '../ui';
import styles from './Ribbon.module.css';
import rowStyles from './RibbonPlaceLocalityRow.module.css';

/**
 * A lokalitet's rectangle while it is being placed, before anything has been
 * written. One line, because the rectangle is on the map and a panel would
 * cover the terrain being framed. `Opprett` is the session's only write;
 * `Avbryt` has nothing to undo.
 */
export const RibbonPlaceLocalityRow = ({
  placement,
}: {
  placement: LocalityPlacement;
}) => {
  const { t, i18n } = useTranslation();
  const place = useLocalityPlacement(placement);

  return (
    <div className={cx(styles.row, styles.rowSub, rowStyles.row)}>
      <span className={rowStyles.label}>{t('localities.placing.heading')}</span>

      <span className={rowStyles.span}>
        {formatBboxSpan(place.bbox, i18n.language)}
        {' · '}
        {formatBboxArea(place.bbox, i18n.language)}
      </span>

      {/* Why the drag stopped: the band is what the producers can render
          (bboxLimits.ts), so the row says the number. */}
      {place.atLimit && (
        <span className={rowStyles.limit}>
          <Icon icon="crop_free" size={16} />
          {t(
            place.atLimit === 'max'
              ? 'localities.placing.atMax'
              : 'localities.placing.atMin',
            { max: MAX_SIDE_M, min: MIN_SIDE_M },
          )}
        </span>
      )}

      <span className={rowStyles.hint}>{t('localities.placing.hint')}</span>

      <div className={rowStyles.actions}>
        <Button
          variant="primary"
          leftIcon="check"
          disabled={place.creating}
          onClick={place.commit}
          title={t('localities.placing.createHint')}
        >
          {t(
            place.creating
              ? 'localities.placing.creating'
              : 'localities.placing.create',
          )}
        </Button>
        <Button
          variant="ghost"
          palette="gray"
          disabled={place.creating}
          onClick={place.cancel}
        >
          {t('localities.placing.cancel')}
        </Button>
      </div>
    </div>
  );
};
