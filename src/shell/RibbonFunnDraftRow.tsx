import { useTranslation } from 'react-i18next';
import type { LocalityWorkspaceApi } from '../localities/useLocalityWorkspace';
import { Button, cx, Icon, Input } from '../ui';
import styles from './Ribbon.module.css';
import rowStyles from './RibbonFunnDraftRow.module.css';

/**
 * Row 3 — naming the funn being drawn, up only for as long as the draft is.
 * The pen itself is on the bottom edge.
 *
 * Nothing here talks to a server: the title edits the buffered record on blur
 * and reaches PocketBase with everything else on the lokalitet row's `Lagre`,
 * so the state word beside the field says buffered, never "lagret". The note
 * is in the funn popover and the exits are on the lokalitet row's right zone,
 * with every other way out of this lokalitet.
 */
export const RibbonFunnDraftRow = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();

  return (
    <div className={cx(styles.row, styles.rowSub, rowStyles.row)}>
      <span className={rowStyles.label}>
        {t(
          ws.draftIsEdit
            ? 'localities.funn.draft.headingEdit'
            : 'localities.funn.draft.heading',
        )}
      </span>

      <Input
        className={rowStyles.title}
        value={ws.funnTitle}
        onChange={(e) => ws.setFunnTitle(e.target.value)}
        onBlur={ws.commitDraftMeta}
        placeholder={t('localities.funn.draft.titlePlaceholder')}
        maxLength={200}
      />

      <span className={rowStyles.state}>
        {t(
          ws.draftFunnId
            ? 'localities.funn.draft.buffered'
            : 'localities.funn.draft.pending',
        )}
      </span>

      {ws.funnOutside && (
        <span className={rowStyles.outside}>
          <Icon icon="crop_free" size={16} />
          {t('localities.funn.growHint')}
          <Button size="xs" variant="secondary" onClick={ws.growToFitDrawing}>
            {t('localities.funn.growConfirmAction')}
          </Button>
        </span>
      )}
    </div>
  );
};
