import { useTranslation } from 'react-i18next';
import type { LocalityWorkspaceApi } from '../localities/useLocalityWorkspace';
import { Button, cx, Icon, Input } from '../ui';
import styles from './Ribbon.module.css';
import rowStyles from './RibbonFunnDraftRow.module.css';

/**
 * Row 3 — the funn being drawn, while it is being drawn
 * (docs/lokalitet-view.md §6).
 *
 * The other half of the dock's funn draft band. The pen went to the bottom
 * edge, where the hand is; the naming stayed at the top, where the rest of
 * this record's identity is. One line, no body, which is what the ribbon rule
 * permits — and it is up only for as long as the draft is.
 *
 * Three things on it and nothing else:
 *
 * - **The title**, editing the buffered record on blur, exactly as a row in
 *   the funn list does. There is no `Lagre` here: the funn is a record in the
 *   draft from the moment its first shape closes, and it reaches PocketBase
 *   with everything else when the lokalitet row's `Lagre` is pressed (§5.6).
 *   Which is what the state word beside the field now says. It used to report
 *   a write — *Lagrer…* / *Lagret* / *Ikke lagret ennå* — and there is no
 *   write to report; saying "lagret" of something that exists only in this
 *   tab would be the transaction's one unforgivable lie.
 * - **`Utvid området`**, only while the drawing sticks out of the lokalitet's
 *   rectangle. Worth remarking on — a lokalitet is meant to hold the whole
 *   extent of its funn — but never worth stopping the pen for, so it is an
 *   inline warning rather than the modal it used to be.
 *
 * There is no error line any more, for the same reason: nothing on this row
 * talks to a server, so there is nothing here that can fail. A commit that
 * half-lands is reported once, by the verb that started it.
 *
 * The note is deliberately absent: it moved to the funn popover (§6). A
 * textarea will not fit a ribbon row, and a note is written after you have
 * looked at the thing rather than while your hand is on the pen.
 *
 * The exits are not here either. `Ferdig med funn` / `Forkast funn` are depth
 * 2 of the lokalitet row's right zone (§5.3), where every other way out of
 * this lokalitet already is — two rows offering to end the same draft at
 * opposite ends of the bar is the thing that zone exists to prevent.
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
