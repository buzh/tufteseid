import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { ChangeEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { creditOf, type LocalityRecord } from '../api/localities';
import { funnHiddenAtom, funnSwitchedOffAtom } from '../localities/atoms';
import { funnGroupsOf, funnSectionsOf } from '../localities/funnGroups';
import { FunnList } from '../localities/FunnList';
import { copyShareLink } from '../localities/shareLink';
import {
  bilderStripOpenAtom,
  localityDetailsOpenAtom,
} from '../localities/toolAtoms';
import type { LocalityWorkspaceApi } from '../localities/useLocalityWorkspace';
import {
  Badge,
  type BadgePalette,
  Button,
  cx,
  Dialog,
  IconButton,
  Input,
  Menu,
  toast,
  Tooltip,
} from '../ui';
import { BildeControl } from './BildeControl';
import { CompareControl } from './compare/CompareControl';
import { groundHandleAtom } from './groundHandle';
import { LayerGroup, LayerMembers } from './LayerGroup';
import { ModeButton } from './ModeButton';
import styles from './Ribbon.module.css';
import rowStyles from './RibbonLocalityRow.module.css';
import { VisningControl } from './VisningControl';

const VISIBILITY_PALETTE: Record<LocalityRecord['visibility'], BadgePalette> = {
  private: 'gray',
  limited: 'yellow',
  public: 'green',
};

// Must be keyed on locality.id by the parent, or swapping lokalitet shows the
// previous one's half-typed name.
const LocalityName = ({
  locality,
  canEdit,
  onRename,
  onZoom,
}: {
  locality: LocalityRecord;
  canEdit: boolean;
  onRename: (next: string) => Promise<boolean>;
  onZoom: () => void;
}) => {
  const { t } = useTranslation();
  // Only when the stedsnavn lookup came back with nothing.
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
      <h2 className={rowStyles.name}>
        <button
          type="button"
          className={cx(
            rowStyles.nameButton,
            canEdit && rowStyles.nameEditable,
          )}
          title={
            canEdit
              ? t('localities.workspace.renameHint')
              : t('localities.workspace.zoom')
          }
          onClick={() => (canEdit ? setRenaming(true) : onZoom())}
        >
          {locality.name}
        </button>
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

// The short code, click to copy: stable across a rename and a resize.
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

/* The verbs that are not part of the loop, kept off the row itself. */
const OverflowMenu = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const setDetailsOpen = useSetAtom(localityDetailsOpenAtom);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      <Menu
        align="end"
        width={240}
        label={t('localities.workspace.more')}
        trigger={(p) => (
          <IconButton
            icon="more_vert"
            size="md"
            palette="gray"
            aria-label={t('localities.workspace.more')}
            aria-expanded={p.open}
            onClick={p.onClick}
          />
        )}
        items={[
          /* Zoom-to lives here because the name means rename in edit. */
          {
            icon: 'zoom_in_map',
            label: t('localities.workspace.zoom'),
            onSelect: ws.zoomToLocality,
          },
          ws.canAdd && {
            icon: 'add_photo_alternate',
            label: t('localities.bilder.upload'),
            disabled: ws.uploading,
            onSelect: () => fileInputRef.current?.click(),
          },
          /* Both stances: `LocalityDetails` is read-only without `canEdit`. */
          {
            icon: 'info',
            label: t('localities.workspace.details'),
            onSelect: () => setDetailsOpen(true),
          },
          /* Every access level: the link grants nothing new. */
          {
            icon: 'share',
            label: t('localities.share.copyLink'),
            disabled: !ws.locality.code,
            onSelect: () => copyShareLink(ws.locality),
          },
          /* Every access level: a bundle is a read, and its one write —
             forcing a pin — is gated on `canAdd` in `runTakeout`. */
          {
            icon: 'folder_zip',
            label: t('localities.takeout.action'),
            // `runTakeout` refuses to pack a half-loaded lokalitet.
            disabled:
              ws.takeoutProgress != null ||
              ws.bilderItems == null ||
              ws.findItems == null,
            onSelect: () => void ws.runTakeout(),
          },
          /* `canEdit`, not `mayEdit`: the menu is on the row in show too. */
          ws.canEdit && {
            icon: 'transform',
            label: t('localities.workspace.adjust'),
            active: ws.adjusting,
            onSelect: ws.toggleAdjusting,
          },
          ws.canEdit && {
            icon: 'delete',
            label: t('localities.workspace.deleteLocality'),
            danger: true,
            confirm: {
              title: t('localities.workspace.confirmDelete', {
                name: ws.locality.name,
              }),
              confirmLabel: t('localities.workspace.deleteLocality'),
              cancelLabel: t('shared.cancel'),
            },
            onSelect: ws.removeLocality,
          },
        ]}
      />
    </>
  );
};

// `Hent ▾` — two routes to a batch of proposals. `active` while the LiDAR
// dialog is up, so `U` still lights the row.
const HentMenu = ({
  ws,
  active,
}: {
  ws: LocalityWorkspaceApi;
  active: boolean;
}) => {
  const { t } = useTranslation();

  return (
    <Menu
      width={240}
      label={t('localities.tools.hent')}
      trigger={(p) => (
        <ModeButton
          icon="download"
          label={t('localities.tools.hent')}
          tooltip={t('localities.tools.hentHint')}
          active={active || p.open}
          onClick={p.onClick}
        />
      )}
      items={[
        {
          icon: 'crop_free',
          label: `${t('localities.tools.lidarExtract')} (U)`,
          active,
          onSelect: ws.toggleLidar,
        },
        {
          icon: 'satellite_alt',
          label: t('localities.tools.flyfoto'),
          onSelect: ws.openFlyfotoNotice,
        },
      ]}
    />
  );
};

/*
 * `[Funn ▾]` — top of the map's z-stack (`funnLayer`, zIndex 5), so rightmost
 * on the row. Brings `FunnList` rather than the generic member rows, and
 * closes on select because selecting flies the map. No opacity: one vector
 * layer cannot fade per funn without becoming N layers.
 */
const FunnControl = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const [hidden, setHidden] = useAtom(funnHiddenAtom);
  const [switchedOff, setSwitchedOff] = useAtom(funnSwitchedOffAtom);

  const toggleShown = (id: string) =>
    setSwitchedOff((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // The index minus this session's tombstones and the ones switched off.
  const shownCount = (ws.findItems ?? []).filter(
    (f) => !ws.deletedIds.has(f.id) && !switchedOff.has(f.id),
  ).length;

  return (
    <LayerGroup
      icon="bookmark"
      label={t('localities.funn.heading')}
      toggleLabel={t(hidden ? 'localities.funn.show' : 'localities.funn.hide')}
      membersLabel={t('localities.funn.listHint')}
      hint="H"
      shown={!hidden}
      shownCount={shownCount}
      width={360}
      padded
      onToggle={() => setHidden(!hidden)}
    >
      {(close) => (
        <FunnList
          items={ws.findItems}
          editable={ws.canEdit}
          drawable={ws.canAdd}
          selectedId={ws.selectedFunnId}
          deletedIds={ws.deletedIds}
          switchedOffIds={switchedOff}
          onToggleShown={toggleShown}
          onSelect={(f) => {
            close();
            ws.selectFunn(f);
          }}
          onStatus={ws.changeStatus}
          onSaveMeta={ws.saveFunnMeta}
          onEditGeometry={(f) => {
            close();
            ws.startGeometryEdit(f);
          }}
          onDelete={ws.removeFunn}
          onRestore={ws.restoreDeleted}
        />
      )}
    </LayerGroup>
  );
};

/*
 * `[Skisse ▾]` — the sketch overlays at `zIndex: 2`. Absent rather than
 * disabled with no sketches. Paint order is `orderedByFunn`, the same list
 * `useLocalityWorkspace`'s overlay effect walks.
 */
const SkisseControl = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const groups = funnGroupsOf(ws.sketchItems, ws.findItems);
  const sections = funnSectionsOf(groups, {
    none: t('localities.funn.none'),
    untitled: t('localities.funn.untitled'),
  });
  const members = groups
    .flatMap((g) => g.items)
    .map((rec, i) => ({
      id: rec.id,
      // Numbered off this list, so the numbering never skips.
      label: rec.caption.trim() || t('localities.sketch.caption', { n: i + 1 }),
      shown: ws.sketchShown.has(rec.id),
      opacity: ws.sketchOpacity.get(rec.id) ?? 100,
      section: sections?.get(rec.id),
    }));

  if (members.length === 0) return null;

  return (
    <LayerGroup
      icon="gesture"
      label={t('localities.layers.skisse')}
      toggleLabel={t(
        ws.sketchGroupShown
          ? 'localities.layers.skisseHide'
          : 'localities.layers.skisseShow',
      )}
      membersLabel={t('localities.layers.skisseMembers')}
      shown={ws.sketchGroupShown}
      shownCount={members.filter((m) => m.shown).length}
      onToggle={ws.toggleSketchGroup}
    >
      {() => (
        <LayerMembers
          members={members}
          onPressMember={ws.toggleSketch}
          onSetOpacity={ws.setSketchOpacity}
        />
      )}
    </LayerGroup>
  );
};

// At most one sentence, ranked: the three transient lines outrank the two
// standing ones.
const Banner = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t, i18n } = useTranslation();
  const owner = creditOf(ws.locality);

  if (ws.restoredAt != null) {
    // At most one buffer per lokalitet, so the question is how long ago.
    const when = new Date(ws.restoredAt).toLocaleTimeString(i18n.language, {
      hour: '2-digit',
      minute: '2-digit',
    });
    const text = t('localities.edit.recovered', { time: when });
    return (
      <span className={cx(rowStyles.banner, rowStyles.bannerAlert)}>
        {text}
        <Button
          size="xs"
          variant="ghost"
          palette="red"
          onClick={() => void ws.discardRecovered()}
        >
          {t('localities.edit.recoveredDiscard')}
        </Button>
      </span>
    );
  }

  // Counted rather than a spinner: forty funn over a slow link is long
  // enough for "is it stuck".
  const progress = ws.copyProgress;
  if (progress) {
    const text =
      progress.total === 0
        ? t('localities.copy.progress')
        : t(
            progress.stage === 'finds'
              ? 'localities.copy.progressFunn'
              : 'localities.copy.progressBilder',
            { done: progress.done, total: progress.total },
          );
    return (
      <span className={cx(rowStyles.banner, rowStyles.bannerAlert)}>
        {text}
      </span>
    );
  }

  // Two acts because pinning a View is a tile burst per image where fetching
  // a File is a download.
  const takeout = ws.takeoutProgress;
  if (takeout) {
    const text =
      takeout.stage === 'writing' || takeout.total === 0
        ? t('localities.takeout.progressZip')
        : t(
            takeout.stage === 'pinning'
              ? 'localities.takeout.progressPin'
              : 'localities.takeout.progressFiles',
            { done: takeout.done, total: takeout.total },
          );
    return (
      <span className={cx(rowStyles.banner, rowStyles.bannerAlert)}>
        {text}
      </span>
    );
  }

  if (owner && ws.access !== 'owner') {
    const text =
      ws.stance === 'edit' && ws.access === 'admin'
        ? t('localities.workspace.bannerAdmin', { name: owner })
        : t('localities.workspace.bannerReader', { name: owner });

    return (
      <span className={rowStyles.banner} title={text}>
        {text}
      </span>
    );
  }

  // `derivedFromLabel` is frozen prose, so it still names the original after
  // the original is gone — when the link is withdrawn instead.
  if (ws.derivedLabel) {
    const gone = ws.originalUnavailable;
    const key = gone ? 'localities.copy.bannerGone' : 'localities.copy.banner';
    const text = t(key, { label: ws.derivedLabel });
    return (
      <span className={rowStyles.banner} title={text}>
        {text}
        {!gone && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void ws.openOriginal()}
          >
            {t('localities.copy.openOriginal')}
          </Button>
        )}
      </span>
    );
  }

  return null;
};

/**
 * Depth 1's exits. `Lagre` and `Avbryt` are about the buffer and end nothing;
 * `Avslutt` is about the stance and is the only way out of it. `Avbryt` is
 * absent on a clean buffer while `Lagre` stays and greys, so no button appears
 * and vanishes under the cursor on every keystroke.
 */
const EditExits = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t, i18n } = useTranslation();
  const [confirming, setConfirming] = useState<'discard' | 'exit' | null>(null);
  const counts = ws.draftCounts;

  const parts: string[] = [];
  if (counts) {
    if (counts.bilder > 0) {
      parts.push(t('localities.summary.bilder', { count: counts.bilder }));
    }
    if (counts.finds > 0) {
      parts.push(t('localities.summary.funn', { count: counts.finds }));
    }
    if (counts.deletions > 0) {
      parts.push(
        t('localities.edit.discardDeletions', { count: counts.deletions }),
      );
    }
    if (counts.locality) parts.push(t('localities.edit.discardLocality'));
  }

  /* `Intl.ListFormat` so the conjunction is not a fourth locale string. */
  const what = new Intl.ListFormat(i18n.language, {
    type: 'conjunction',
  }).format(parts);

  const close = () => setConfirming(null);

  const exit = () => {
    if (!ws.dirty) void ws.exitEdit();
    else setConfirming('exit');
  };

  const saveAndExit = async () => {
    close();
    // A half-failed save leaves the remainder in the buffer; leaving the
    // stance would strand it.
    if (await ws.saveEdit()) void ws.exitEdit();
  };

  return (
    <>
      <Button
        variant="primary"
        leftIcon="check"
        disabled={ws.saving || !ws.dirty}
        onClick={() => void ws.saveEdit()}
      >
        {t('localities.edit.save')}
      </Button>
      {ws.dirty && (
        <Button
          variant="ghost"
          palette="gray"
          disabled={ws.saving}
          onClick={() => setConfirming('discard')}
        >
          {t('localities.edit.cancel')}
        </Button>
      )}
      <Button
        variant="secondary"
        leftIcon="edit_off"
        disabled={ws.saving}
        onClick={exit}
        title={t('localities.edit.exitHint')}
      >
        {t('localities.edit.exit')}
      </Button>
      <OverflowMenu ws={ws} />

      <Dialog
        open={confirming === 'discard'}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={t('localities.edit.discardTitle')}
        closeLabel={t('shared.close')}
        footer={
          <>
            <Button size="sm" palette="gray" onClick={close}>
              {t('localities.edit.discardKeep')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              palette="red"
              onClick={() => {
                close();
                void ws.cancelEdit();
              }}
            >
              {t('localities.edit.discardConfirm')}
            </Button>
          </>
        }
      >
        <p className={rowStyles.discardBody}>
          {t('localities.edit.discardBody', { what })}
        </p>
      </Dialog>

      {/* The same question on the way out. `Lagre og avslutt` is the primary
          and the destructive arm is spelled out. */}
      <Dialog
        open={confirming === 'exit'}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={t('localities.edit.exitTitle')}
        closeLabel={t('shared.close')}
        footer={
          <>
            <Button size="sm" palette="gray" onClick={close}>
              {t('localities.edit.exitStay')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              palette="red"
              onClick={() => {
                close();
                void ws.exitEdit();
              }}
            >
              {t('localities.edit.exitDiscard')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={ws.saving}
              onClick={() => void saveAndExit()}
            >
              {t('localities.edit.exitSave')}
            </Button>
          </>
        }
      >
        <p className={rowStyles.discardBody}>
          {t('localities.edit.exitBody', { what })}
        </p>
      </Dialog>
    </>
  );
};

/**
 * Terreng and Sammenlign: both read a rectangle, so both are here rather than
 * on row 1, in either stance. `useGroundMode` stays mounted once in
 * `RibbonGlobalRow` and this reads the slice it publishes; `null` means row 1
 * has not rendered yet or crashed into its boundary.
 */
const ReadTools = () => {
  const { t } = useTranslation();
  const ground = useAtomValue(groundHandleAtom);
  if (!ground) return null;
  return (
    <>
      {/* Digit 5 still selects it: the ring is a fact about GROUND_MODES, not
          about which row draws the button. Disabled rather than hidden on the
          curtain's B half — it is a render over the whole map and cannot be
          one side of a split — so the row does not reflow as you flip A|B. */}
      <ModeButton
        icon="elevation"
        label={t('ribbon.terrain.label')}
        tooltip={
          ground.half === 'b'
            ? t('ribbon.compare.noTerrainRight')
            : `${t('ribbon.terrain.tip')} (5)`
        }
        active={ground.mode === 'terreng'}
        disabled={ground.half === 'b'}
        onClick={() => ground.select('terreng')}
      />
      <CompareControl ground={ground} />
    </>
  );
};

/**
 * Row 2 — the open lokalitet in three zones: the record on the left, the tools
 * that read the ground in the centre, the ways out on the right.
 */
export const RibbonLocalityRow = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const { locality, stance, mayEdit, canAdd, mode } = ws;
  const [stripOpen, setStripOpen] = useAtom(bilderStripOpenAtom);
  const editing = stance === 'edit';

  // This row holds the only way out of the drawing surface, so the pen goes
  // up when the right to add is lost and when the row unmounts. Through a ref:
  // `putPenDown` is rebound when a funn draft arms, and a cleanup keyed on it
  // would lift the pen mid-stroke.
  const { putPenDown } = ws;
  useEffect(() => {
    if (!canAdd) putPenDown();
  }, [canAdd, putPenDown]);
  const penDown = useRef(putPenDown);
  penDown.current = putPenDown;
  useEffect(() => () => penDown.current(), []);

  return (
    <div
      className={cx(
        styles.row,
        styles.rowSub,
        rowStyles.grid,
        editing && rowStyles.rowEdit,
      )}
    >
      <div className={rowStyles.left}>
        <div className={rowStyles.identity}>
          <span className={rowStyles.label}>
            {t('localities.workspace.label')}
          </span>
          <LocalityName
            key={locality.id}
            locality={locality}
            canEdit={ws.canEdit}
            onRename={ws.rename}
            onZoom={ws.zoomToLocality}
          />
          {/* Guarded, not optional: every record has a code once migration
              1700000500 has run, so no chip means pocketbase was not
              restarted. */}
          {locality.code && <LocalityCode code={locality.code} />}
          <Badge
            className={rowStyles.visibility}
            palette={VISIBILITY_PALETTE[locality.visibility]}
          >
            {t(`localities.visibility.${locality.visibility}`)}
          </Badge>
          <Banner ws={ws} />
        </div>

        {/* In front of the write verbs, not behind them, so this zone keeps
            its place when `.tools` appears and disappears with the stance. */}
        <div className={rowStyles.contents}>
          {/* Left to right is bottom to top of the map's z-stack: the ground
              and its Views, the Files over those, the sketches at zIndex 2,
              the funn at 5. */}
          <VisningControl ws={ws} />
          <BildeControl ws={ws} />
          <SkisseControl ws={ws} />
          <FunnControl ws={ws} />
          {/* The drawer, and only the drawer: nothing it does touches the
              map, so it is never lit — the bar's own presence is the state. */}
          <ModeButton
            icon="photo_library"
            label={t('localities.bilder.heading')}
            tooltip={t(
              stripOpen
                ? 'localities.bilder.hideStrip'
                : 'localities.bilder.showStrip',
            )}
            badge={ws.bilderCount || undefined}
            // Would open an empty bar: a reader on an empty lokalitet.
            disabled={!ws.hasBilder}
            onClick={() => setStripOpen(!stripOpen)}
          />
        </div>

        {/* Everything that leaves a trace, so nothing at all in show. Gated
            on `canAdd` as a block rather than per button: every one of these
            creates content, so an admin — who may edit this record but not add
            to it — gets no zone rather than an empty gap. */}
        {canAdd && (
          <div className={rowStyles.tools}>
            <ModeButton
              icon="add"
              label={t('localities.funn.new')}
              tooltip={`${t('localities.funn.new')} (N)`}
              active={mode === 'draft'}
              onClick={() =>
                ws.draftActive ? ws.stopDraft() : ws.startDraft()
              }
            />
            {/* The other thing the same pen makes: a transparent overlay,
                kept as its strokes rather than converted to geometry. */}
            <ModeButton
              icon="draw"
              label={t('localities.tools.draw')}
              tooltip={t('localities.tools.drawHint')}
              active={ws.sketchActive}
              onClick={() =>
                ws.sketchActive ? ws.stopSketch() : ws.startSketch()
              }
            />
            {/* Whatever the map is showing, kept at the source's own
                resolution rather than photographed off the screen. Disabled
                rather than hidden on Standard and Hybrid, which cannot be
                fetched as data, so the row does not reflow as you walk the
                ground ring; the tooltip names the verb that can. */}
            <ModeButton
              icon={ws.beholdDone ? 'check' : 'library_add'}
              label={
                ws.beholdDone
                  ? t('localities.tools.beholdDone')
                  : t('localities.tools.behold')
              }
              tooltip={
                ws.beholdGround === 'standard' || ws.beholdGround === 'hybrid'
                  ? t('localities.tools.beholdHintScreenshot')
                  : ws.beholdDone
                    ? t('localities.tools.beholdHintDone')
                    : t('localities.tools.beholdHint')
              }
              disabled={!ws.beholdReady || ws.beholdDone}
              onClick={ws.behold}
            />
            {/* The same verb one level up: `Behold` keeps the ground, this
                keeps the stack over it. Here rather than in the layer row
                because nothing in that row writes. */}
            <ModeButton
              icon="stacks"
              label={t('localities.scene.keep')}
              tooltip={
                ws.canKeepScene
                  ? t('localities.scene.keepHint')
                  : t('localities.scene.keepEmpty')
              }
              disabled={!ws.canKeepScene}
              onClick={ws.keepScene}
            />
            <HentMenu ws={ws} active={mode === 'lidar'} />
            <ModeButton
              icon="photo_camera"
              label={t('localities.tools.screenshotShort')}
              tooltip={`${t('localities.tools.screenshot')} (B)`}
              disabled={ws.shooting}
              onClick={ws.takeScreenshot}
            />
          </div>
        )}
      </div>

      {/* The centre cell: the two tools that interrogate the ground itself,
          in both stances and in full for a reader. Only their exits write. */}
      <div className={rowStyles.terrain}>
        <ReadTools />
      </div>

      {/* The right cell: nothing but the ways out, deepest-first. The deepest
          thing in flight owns the zone and everything shallower is hidden, so
          the row never offers to end two things with two buttons that both say
          `Ferdig`. `Lukk` is absent in edit — you leave the stance before you
          leave the record. */}
      <div className={rowStyles.exits}>
        {ws.draftActive ? (
          <>
            <Button
              variant="primary"
              leftIcon="check"
              onClick={ws.stopDraft}
              title={t('localities.funn.draft.doneHint')}
            >
              {t('localities.funn.draft.done')}
            </Button>
            {/* Nothing has been written either way, so `Forkast funn` can
                forget a fresh funn and put an edited one's old shape back. */}
            <Button
              variant="ghost"
              palette="red"
              leftIcon="undo"
              onClick={ws.discardDraft}
            >
              {t('localities.funn.draft.discard')}
            </Button>
          </>
        ) : ws.sketchActive ? (
          /* A funn is in the buffer stroke by stroke; a sketch is written
             nowhere until this button. */
          <>
            <Button
              variant="primary"
              leftIcon="check"
              onClick={ws.keepSketch}
              title={t('localities.sketch.keepHint')}
            >
              {t('localities.sketch.keep')}
            </Button>
            <Button variant="ghost" leftIcon="undo" onClick={ws.stopSketch}>
              {t('localities.sketch.cancel')}
            </Button>
          </>
        ) : ws.adjusting ? (
          /* The rectangle moves in the buffer, so `Angre` puts a value back
             rather than issuing a second PATCH. */
          <>
            <Button variant="primary" leftIcon="check" onClick={ws.applyAdjust}>
              {t('localities.workspace.adjustApply')}
            </Button>
            <Button variant="ghost" leftIcon="undo" onClick={ws.undoAdjust}>
              {t('localities.workspace.adjustUndo')}
            </Button>
          </>
        ) : editing ? (
          <EditExits ws={ws} />
        ) : (
          <>
            {/* One slot, two labels: `Rediger` costs nothing, `Lag min kopi`
                costs a record, and each says which. */}
            {mayEdit ? (
              <Button
                variant="secondary"
                leftIcon="edit"
                onClick={ws.enterEdit}
              >
                {t('localities.workspace.edit')}
              </Button>
            ) : (
              ws.user != null && (
                <Button
                  variant="secondary"
                  leftIcon="content_copy"
                  disabled={ws.copyProgress != null}
                  onClick={ws.openCopyPrompt}
                >
                  {t('localities.copy.action')}
                </Button>
              )
            )}
            <Button variant="ghost" palette="gray" onClick={ws.close}>
              {t('localities.workspace.close')}
            </Button>
            {/* `[⋮]` in show too: it is how a reader opens Detaljer. Its
                write verbs are gated inside. */}
            <OverflowMenu ws={ws} />
          </>
        )}
      </div>
    </div>
  );
};
