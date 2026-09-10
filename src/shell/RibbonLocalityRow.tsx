import type { ChangeEvent } from 'react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalityRecord } from '../api/localities';
import type { LocalityWorkspaceApi } from '../localities/useLocalityWorkspace';
import {
  Badge,
  type BadgePalette,
  ConfirmPopover,
  cx,
  IconButton,
  Input,
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
  // Creation frames first and names after, so a record still carrying the
  // default name opens straight into the field.
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

/**
 * Row 2 — the open lokalitet: what it is on the left, what you can do to it
 * on the right.
 *
 * Every verb here either flips the surface below (Nytt funn, LiDAR, Terreng)
 * or acts on the rectangle in place (Bilde, Flyfoto, Last opp, Juster). They
 * share a row because they share a subject; which of them takes the tool row
 * over is the controller's business, not this component's.
 */
export const RibbonLocalityRow = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const { locality, isMine, mode } = ws;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) ws.uploadFile(file);
  };

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
        {isMine && (
          <ConfirmPopover
            title={t('localities.workspace.confirmDelete', {
              name: locality.name,
            })}
            confirmLabel={t('localities.workspace.deleteLocality')}
            cancelLabel={t('shared.cancel')}
            onConfirm={ws.removeLocality}
            trigger={(props) => (
              <IconButton
                icon="delete"
                size="md"
                palette="red"
                aria-label={t('localities.workspace.deleteLocality')}
                {...props}
              />
            )}
          />
        )}
      </div>

      <div className={rowStyles.verbs}>
        {isMine && (
          <ModeButton
            icon="add"
            label={t('localities.funn.new')}
            tooltip={`${t('localities.funn.new')} (N)`}
            active={mode === 'draft'}
            onClick={() =>
              ws.draftActive ? ws.cancelDraft() : ws.startDraft()
            }
          />
        )}
        <ModeButton
          icon="crop_free"
          label={t('localities.tools.lidarExtractShort')}
          tooltip={`${t('localities.tools.lidarExtract')} (U)`}
          active={mode === 'lidar'}
          onClick={ws.toggleLidar}
        />
        <ModeButton
          icon="elevation"
          label={t('localities.terrain.short')}
          tooltip={t('localities.terrain.tooltip')}
          active={mode === 'terrain'}
          onClick={ws.toggleTerrain}
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
        {isMine && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={pickFile}
            />
            <ModeButton
              icon="add_photo_alternate"
              label={t('localities.bilder.upload')}
              tooltip={t('localities.bilder.upload')}
              disabled={ws.uploading}
              onClick={() => fileInputRef.current?.click()}
            />
          </>
        )}
        {isMine && (
          <ModeButton
            icon="transform"
            label={t('localities.workspace.adjustShort')}
            tooltip={t('localities.workspace.adjust')}
            active={ws.adjusting}
            onClick={ws.toggleAdjusting}
          />
        )}
      </div>
    </div>
  );
};
