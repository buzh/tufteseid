import { useAtom } from 'jotai';
import type { ChangeEvent, MouseEvent } from 'react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalityRecord } from '../api/localities';
import { bilderStripOpenAtom } from '../localities/toolAtoms';
import type { LocalityWorkspaceApi } from '../localities/useLocalityWorkspace';
import {
  Badge,
  type BadgePalette,
  Button,
  cx,
  Icon,
  IconButton,
  Input,
  Popover,
  toast,
  Tooltip,
} from '../ui';
import { ModeButton } from './ModeButton';
import styles from './Ribbon.module.css';
import rowStyles from './RibbonLocalityRow.module.css';

const VISIBILITY_PALETTE: Record<
  LocalityRecord['visibility'],
  BadgePalette
> = {
  private: 'gray',
  limited: 'yellow',
  public: 'green',
};

/*
 * Name display and inline rename. A component of its own so the parent can
 * key it on locality.id: without that, swapping lokalitet shows the previous
 * one's half-typed name, and a fresh record does not re-open the field.
 */
const LocalityName = ({
  locality,
  canEdit,
  onRename,
}: {
  locality: LocalityRecord;
  canEdit: boolean;
  onRename: (next: string) => Promise<boolean>;
}) => {
  const { t } = useTranslation();
  // A new lokalitet is normally named after the nearest stedsnavn, and an
  // auto-name good enough to keep should not shove a cursor at you — click
  // it to change it, like any other. The field only opens by itself when
  // that lookup came back with nothing, i.e. the record really is unnamed.
  const [renaming, setRenaming] = useState(
    locality.name === t('localities.defaultName'),
  );
  const [name, setName] = useState(locality.name);

  const commit = async () => {
    setRenaming(false);
    if (!(await onRename(name))) setName(locality.name);
  };

  if (!renaming || !canEdit) {
    return (
      <h2
        className={cx(rowStyles.name, canEdit && rowStyles.nameEditable)}
        title={canEdit ? t('localities.workspace.renameHint') : undefined}
        onClick={() => canEdit && setRenaming(true)}
      >
        {locality.name}
      </h2>
    );
  }

  return (
    <Input
      className={rowStyles.nameInput}
      value={name}
      autoFocus
      maxLength={200}
      placeholder={t('localities.workspace.namePlaceholder')}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setName(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setName(locality.name);
          setRenaming(false);
        }
      }}
    />
  );
};

/*
 * The short code, click to copy.
 *
 * Six characters that address this lokalitet without being its 15-character
 * PB id: readable aloud, writable on paper, and stable across a rename and a
 * "Juster området", which is what lets a report to Riksantikvaren cite it.
 * It is the record's handle, so a reader sees it too, not just the owner.
 */
const LocalityCode = ({ code }: { code: string }) => {
  const { t } = useTranslation();

  return (
    <Tooltip label={t('localities.workspace.codeHint')}>
      <button
        type="button"
        className={rowStyles.code}
        onClick={() => {
          navigator.clipboard.writeText(code);
          toast.create({
            title: t('localities.workspace.codeCopied', { code }),
            duration: 2000,
          });
        }}
      >
        {code}
      </button>
    </Tooltip>
  );
};

/*
 * The verbs that are not part of the loop: uploading a file you already have,
 * reshaping the rectangle, throwing the whole thing away. Behind a menu
 * because the strip beside it has to stay short enough to read at a glance —
 * this row is a context strip now, not a toolbar.
 */
const OverflowMenu = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const close = () => {
    setOpen(false);
    setConfirming(false);
  };

  const pickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) ws.uploadFile(file);
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={pickFile}
      />
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirming(false);
        }}
        align="end"
        width={240}
        label={t('localities.workspace.more')}
        trigger={
          <IconButton
            icon="more_vert"
            size="md"
            palette="gray"
            aria-label={t('localities.workspace.more')}
            aria-expanded={open}
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
              setOpen(!open);
            }}
          />
        }
      >
        {confirming ? (
          <>
            <p className={rowStyles.menuTitle}>
              {t('localities.workspace.confirmDelete', {
                name: ws.locality.name,
              })}
            </p>
            <div className={rowStyles.confirmActions}>
              <Button
                size="xs"
                palette="gray"
                onClick={() => setConfirming(false)}
              >
                {t('shared.cancel')}
              </Button>
              <Button
                size="xs"
                variant="primary"
                palette="red"
                onClick={() => {
                  close();
                  ws.removeLocality();
                }}
              >
                {t('localities.workspace.deleteLocality')}
              </Button>
            </div>
          </>
        ) : (
          <div className={rowStyles.menu}>
            {/* The two that put new content in are owner-only, so an admin's
                menu is Juster området and Slett — the two the server would
                actually let them through with. */}
            {ws.canAdd && (
              <>
                {/* First in the list because it is the one thing here you do
                    on a lokalitet you have just made, and never again. */}
                <button
                  type="button"
                  className={rowStyles.menuItem}
                  disabled={ws.starterStep != null}
                  title={t('localities.tools.starterHint')}
                  onClick={() => {
                    close();
                    void ws.runStarterPack();
                  }}
                >
                  <Icon icon="library_add" size={16} />
                  {t('localities.tools.starter')}
                </button>
                <button
                  type="button"
                  className={rowStyles.menuItem}
                  disabled={ws.uploading}
                  onClick={() => {
                    close();
                    fileInputRef.current?.click();
                  }}
                >
                  <Icon icon="add_photo_alternate" size={16} />
                  {t('localities.bilder.upload')}
                </button>
              </>
            )}
            <button
              type="button"
              className={cx(
                rowStyles.menuItem,
                ws.adjusting && rowStyles.menuItemActive,
              )}
              onClick={() => {
                close();
                ws.toggleAdjusting();
              }}
            >
              <Icon icon="transform" size={16} />
              {t('localities.workspace.adjust')}
            </button>
            <button
              type="button"
              className={cx(rowStyles.menuItem, rowStyles.menuItemDanger)}
              onClick={() => setConfirming(true)}
            >
              <Icon icon="delete" size={16} />
              {t('localities.workspace.deleteLocality')}
            </button>
          </div>
        )}
      </Popover>
    </>
  );
};

/*
 * The banner slot — docs/lokalitet-view.md §5.7. It occupies the space the
 * summary used to, holds at most one sentence, and answers exactly one
 * question: whose is this and what state is it in.
 *
 * Only two of the five ranks exist yet; the other three arrive with the copy
 * (§7) and the transaction (§5.6). The `admin` one is keyed on the *stance*
 * rather than on access alone — the doc's table says "admin, not owner"
 * unqualified, but "Du redigerer …" printed over show mode would be a false
 * sentence, and this slot exists to say what state you are in.
 */
const Banner = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const owner = ws.locality.expand?.owner?.name;
  if (!owner || ws.access === 'owner') return null;

  const text =
    ws.stance === 'edit' && ws.access === 'admin'
      ? t('localities.workspace.bannerAdmin', { name: owner })
      : t('localities.workspace.bannerReader', { name: owner });

  return (
    <span className={rowStyles.banner} title={text}>
      {text}
    </span>
  );
};

/**
 * Row 2 — the open lokalitet, in three zones (docs/lokalitet-view.md §5.1).
 *
 * | left   | identity  | *what am I looking at* | always    |
 * | middle | the work  | *what can I do to it*  | edit only |
 * | right  | the exits | *how do I get out*     | always    |
 *
 * That grammar is the point: your eye goes left to know where you are and
 * right to know what to press, and the space between them is either empty
 * (show) or full of tools (edit), so the stance is legible from across the
 * room without reading a word. The tint is the confirmation, not the signal.
 *
 * The `[←]` back arrow is gone. Leaving is an exit, exits are on the right,
 * and one lokalitet should not have two ways out at opposite ends of a row.
 *
 * Still a context strip, not a surface: everything with a body is in the dock
 * (until step 7 takes it), and nothing here opens downwards. Terreng is not
 * on it either — it is a ground mode and lives in row 1 with the other four
 * until §8's move.
 */
export const RibbonLocalityRow = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const { locality, stance, mayEdit, canAdd, mode } = ws;
  const [stripOpen, setStripOpen] = useAtom(bilderStripOpenAtom);
  const editing = stance === 'edit';

  return (
    <div
      className={cx(styles.row, styles.rowSub, editing && rowStyles.rowEdit)}
    >
      <div className={rowStyles.identity}>
        {/* The literal word. The only chrome in the app scoped to a single
            record, and cheap — it is what makes removing the back arrow safe,
            because "a differently coloured row" is not the same statement as
            "you are inside something". */}
        <span className={rowStyles.label}>
          {t('localities.workspace.label')}
        </span>
        <LocalityName
          key={locality.id}
          locality={locality}
          canEdit={ws.canEdit}
          onRename={ws.rename}
        />
        {/* Guarded, not optional: every record has a code once 1700000500
            has run. No chip is the honest symptom of a pocketbase that has
            not been restarted since. */}
        {locality.code && <LocalityCode code={locality.code} />}
        <Badge
          className={rowStyles.visibility}
          palette={VISIBILITY_PALETTE[locality.visibility]}
        >
          {t(`localities.visibility.${locality.visibility}`)}
        </Badge>
        <Banner ws={ws} />
        <Tooltip label={t('localities.workspace.zoom')}>
          <IconButton
            icon="zoom_in_map"
            size="md"
            aria-label={t('localities.workspace.zoom')}
            onClick={ws.zoomToLocality}
          />
        </Tooltip>
      </div>

      {/* The middle zone: everything that leaves a trace, and therefore
          nothing at all in show (§2). Gated on `canAdd` as a block rather
          than per button because all four create content, so for an admin —
          who may edit this record but not add to it — the zone is empty and
          should not render its gap. */}
      {canAdd && (
        <div className={rowStyles.tools}>
          <ModeButton
            icon="add"
            label={t('localities.funn.new')}
            tooltip={`${t('localities.funn.new')} (N)`}
            active={mode === 'draft'}
            onClick={() => (ws.draftActive ? ws.stopDraft() : ws.startDraft())}
          />
          <ModeButton
            icon="crop_free"
            label={t('localities.tools.lidarExtractShort')}
            tooltip={`${t('localities.tools.lidarExtract')} (U)`}
            active={mode === 'lidar'}
            onClick={ws.toggleLidar}
          />
          <ModeButton
            icon="photo_camera"
            label={t('localities.tools.screenshotShort')}
            tooltip={`${t('localities.tools.screenshot')} (B)`}
            disabled={ws.shooting}
            onClick={ws.takeScreenshot}
          />
          <ModeButton
            icon="satellite_alt"
            label={t('localities.tools.flyfotoShort')}
            tooltip={t('localities.tools.flyfoto')}
            disabled={ws.fetchingFlyfoto}
            onClick={ws.openFlyfotoNotice}
          />
        </div>
      )}

      {/* Between the middle zone and the exits sit the read tools (§5.5).
          `Terreng` and `Sammenlign` join them at step 15; today it is the one
          toggle for the bottom edge. Present in **both** stances, because
          looking at the images is not writing to them — which is the whole
          argument of §2 — and it is the only control that puts the strip back
          once it has been folded away. */}
      <div className={rowStyles.reading}>
        <ModeButton
          icon="photo_library"
          label={t('localities.bilder.heading')}
          tooltip={
            stripOpen
              ? t('localities.bilder.hideStrip')
              : t('localities.bilder.showStrip')
          }
          active={stripOpen}
          badge={ws.bilderCount || undefined}
          // Nothing to show and no way to put anything there: a reader on an
          // empty lokalitet. The button would open an empty bar.
          disabled={!ws.hasBilder}
          onClick={() => setStripOpen(!stripOpen)}
        />
      </div>

      {/* The right zone, deepest-first (§5.3). Depths 0 and 1 for now: the
          funn draft and Juster området keep their own controls in the dock
          until step 12 moves them up here as depth 2.

          `Lukk` is absent in edit — you leave the stance before you leave the
          record — and `Del` is absent everywhere until `?lok=CODE` exists,
          since a share button that shares nothing is worse than none. For a
          reader the `Rediger` slot is `Lag min kopi`, which arrives with the
          copy in step 14; until then that slot is empty rather than filled
          with a button that would lie. */}
      <div className={rowStyles.exits}>
        {editing ? (
          <>
            <Button variant="primary" leftIcon="check" onClick={ws.leaveEdit}>
              {t('localities.workspace.done')}
            </Button>
            <OverflowMenu ws={ws} />
          </>
        ) : (
          <>
            {mayEdit && (
              <Button
                variant="secondary"
                leftIcon="edit"
                onClick={ws.enterEdit}
              >
                {t('localities.workspace.edit')}
              </Button>
            )}
            <Button variant="ghost" palette="gray" onClick={ws.close}>
              {t('localities.workspace.close')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
