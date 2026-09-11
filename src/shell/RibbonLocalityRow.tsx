import type { ChangeEvent, MouseEvent } from 'react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalityRecord } from '../api/localities';
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
  isMine,
  onRename,
}: {
  locality: LocalityRecord;
  isMine: boolean;
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

  if (!renaming || !isMine) {
    return (
      <h2
        className={cx(rowStyles.name, isMine && rowStyles.nameEditable)}
        title={isMine ? t('localities.workspace.renameHint') : undefined}
        onClick={() => isMine && setRenaming(true)}
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
            {/* First in the list because it is the one thing here you do on
                a lokalitet you have just made, and never again. */}
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

/**
 * Row 2 — the open lokalitet, as one line: what it is on the left, the verbs
 * that are part of the loop on the right, the rest behind a menu.
 *
 * A context strip, not a surface. Everything with a body — the funn list, the
 * gallery, the draft form, the extract and terrain panels — is in the dock;
 * what is left here is identity and the verbs you reach for while reading the
 * ground. Nothing in this row opens downwards.
 *
 * Terreng is *not* one of them: it is a ground mode, lives in row 1 with the
 * other four, and works the same whether a lokalitet is open or not. It only
 * ever appeared here because row 1 hid its copy while a lokalitet was open.
 */
export const RibbonLocalityRow = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const { locality, isMine, mode } = ws;

  return (
    <div className={cx(styles.row, styles.rowSub)}>
      <div className={rowStyles.identity}>
        <IconButton
          icon="arrow_back"
          size="md"
          aria-label={t('localities.workspace.back')}
          onClick={ws.close}
        />
        <LocalityName
          key={locality.id}
          locality={locality}
          isMine={isMine}
          onRename={ws.rename}
        />
        {/* Guarded, not optional: every record has a code once 1700000500
            has run. No chip is the honest symptom of a pocketbase that has
            not been restarted since. */}
        {locality.code && <LocalityCode code={locality.code} />}
        <div className={rowStyles.summary}>
          <Badge palette={VISIBILITY_PALETTE[locality.visibility]}>
            {t(`localities.visibility.${locality.visibility}`)}
          </Badge>
          {ws.summary.length > 0 && (
            <span className={rowStyles.summaryText}>
              {ws.summary.join(' · ')}
            </span>
          )}
        </div>
        <Tooltip label={t('localities.workspace.zoom')}>
          <IconButton
            icon="zoom_in_map"
            size="md"
            aria-label={t('localities.workspace.zoom')}
            onClick={ws.zoomToLocality}
          />
        </Tooltip>
      </div>

      <div className={rowStyles.verbs}>
        {isMine && (
          <ModeButton
            icon="add"
            label={t('localities.funn.new')}
            tooltip={`${t('localities.funn.new')} (N)`}
            active={mode === 'draft'}
            onClick={() => (ws.draftActive ? ws.stopDraft() : ws.startDraft())}
          />
        )}
        <ModeButton
          icon="crop_free"
          label={t('localities.tools.lidarExtractShort')}
          tooltip={`${t('localities.tools.lidarExtract')} (U)`}
          active={mode === 'lidar'}
          onClick={ws.toggleLidar}
        />
        {isMine && (
          <ModeButton
            icon="photo_camera"
            label={t('localities.tools.screenshotShort')}
            tooltip={`${t('localities.tools.screenshot')} (B)`}
            disabled={ws.shooting}
            onClick={ws.takeScreenshot}
          />
        )}
        {isMine && (
          <ModeButton
            icon="satellite_alt"
            label={t('localities.tools.flyfotoShort')}
            tooltip={t('localities.tools.flyfoto')}
            disabled={ws.fetchingFlyfoto}
            onClick={ws.openFlyfotoNotice}
          />
        )}
        {isMine && <OverflowMenu ws={ws} />}
      </div>
    </div>
  );
};
