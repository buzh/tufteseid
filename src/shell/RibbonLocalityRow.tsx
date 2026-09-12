import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { ChangeEvent } from 'react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalityRecord } from '../api/localities';
import { funnHiddenAtom } from '../localities/atoms';
import { FunnList } from '../localities/FunnList';
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
  Icon,
  IconButton,
  Input,
  Menu,
  Popover,
  toast,
  Tooltip,
} from '../ui';
import { CompareControl } from './compare/CompareControl';
import { groundHandleAtom } from './groundHandle';
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
          /* Putting new content in is owner-only, so an admin's menu is
             Juster området and Slett — the two the server would actually let
             them through with. */
          /* "Hent grunnpakke" was here, and is gone: the starter set now
             arrives with the lokalitet instead of waiting to be found in a
             menu (docs/lokalitet-view.md §4.3). What is left is the one image
             route that is not a fetch at all. */
          ws.canAdd && {
            icon: 'add_photo_alternate',
            label: t('localities.bilder.upload'),
            disabled: ws.uploading,
            onSelect: () => fileInputRef.current?.click(),
          },
          /* Beskrivelse, sted, kommune, matrikkel, synlighet — the fields you
             set once and stop looking at, so they are a dialog reached from
             the menu rather than a panel that was permanently open (§6). Both
             stances: a reader may read them, and `LocalityDetails` renders
             itself read-only without `canEdit`. */
          {
            icon: 'info',
            label: t('localities.workspace.details'),
            onSelect: () => setDetailsOpen(true),
          },
          /* The two that write are `canEdit`, not merely `mayEdit`: the menu
             is on the row in show as well now — Detaljer above has to be
             reachable by a reader — and nothing in show writes (§2). */
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

/*
 * `Hent ▾` — docs/lokalitet-view.md §5.4.
 *
 * Two routes behind one control, and they belong together because they are
 * the same gesture: choose a batch, then triage it in a picker carousel
 * (§4.3). They are also the two rarest things on the row, and a popover is
 * the sanctioned way to keep it one line.
 *
 * The button is `active` while the LiDAR dialog is up, so `U` toggling that
 * dialog still lights something on the row — the key predates the popover and
 * still opens the thing it always opened.
 */
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
 * `Funn` — docs/lokalitet-view.md §5.5, §6. One control, two hit targets:
 * press the labelled half to open the index, press the eye to take the funn
 * off the map.
 *
 * The index is the list that used to be the top half of the dock, in a
 * popover on the row: a line per funn, with the verbs that act on one. The
 * content — the note you wrote about the mound — is beside the mound, in
 * `FunnCallout`, which is why closing this on select is right rather than
 * rude: you asked for a funn, so the map has flown to it and the note is up.
 *
 * A popover and not a dock is the whole bet of §6: this is a thing you consult
 * a few times a session, and it was costing 360 px of terrain permanently for
 * the privilege. The badge is what makes that safe — the count is on the row
 * whether the list is open or not, so "does this rectangle have anything in
 * it" never needs a click.
 *
 * The eye is "Skjul merker", which spent its life on row 1 three rows away
 * from the count of what it hid, grouped with a Sammenlign that then moved
 * here without it. It belongs on this button because this button is what
 * lists exactly the things it hides — the funn layer only ever holds the open
 * lokalitet's funn — and because the two questions are one question: how many
 * are there, and are they in my way right now.
 *
 * Two segments and not a menu item, deliberately. Hiding the funn is what you
 * do *while* dragging the Sammenlign curtain, so it has to stay one press; an
 * item inside the list would be three, one of which covers the ground you
 * were looking at. And the count stays on the labelled half while they are
 * hidden, so hiding never costs you the answer to "is there anything here".
 *
 * Both stances. Reading your own index is not writing to it; `editable` is
 * what decides whether the rows offer the verbs (§2).
 */
const FunnControl = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useAtom(funnHiddenAtom);
  const eyeLabel = t(hidden ? 'localities.funn.show' : 'localities.funn.hide');

  return (
    <div className={rowStyles.split}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        width={360}
        label={t('localities.funn.heading')}
        trigger={
          <ModeButton
            icon="bookmark"
            label={t('localities.funn.heading')}
            tooltip={t('localities.funn.listHint')}
            active={open}
            badge={ws.funnCount || undefined}
            joinedRight
            onClick={() => setOpen(!open)}
          />
        }
      >
        <FunnList
          items={ws.findItems}
          editable={ws.canEdit}
          selectedId={ws.selectedFunnId}
          deletedIds={ws.deletedIds}
          onSelect={(f) => {
            setOpen(false);
            ws.selectFunn(f);
          }}
          onStatus={ws.changeStatus}
          onSaveMeta={ws.saveFunnMeta}
          onEditGeometry={(f) => {
            setOpen(false);
            ws.startGeometryEdit(f);
          }}
          onDelete={ws.removeFunn}
          onRestore={ws.restoreDeleted}
        />
      </Popover>
      {/* Lit while they are hidden, like every other engaged tool on the
          ribbon: the unusual state is the one worth a colour, and "why can I
          not see my funn" must be answerable by looking at the row. */}
      <Tooltip label={`${eyeLabel} (H)`}>
        <button
          type="button"
          className={cx(rowStyles.eye, hidden && rowStyles.eyeOn)}
          aria-pressed={hidden}
          aria-label={eyeLabel}
          onClick={() => setHidden(!hidden)}
        >
          <Icon icon={hidden ? 'visibility_off' : 'visibility'} size={18} />
        </button>
      </Tooltip>
    </div>
  );
};

/*
 * The banner slot — docs/lokalitet-view.md §5.7. It occupies the space the
 * summary used to, holds at most one sentence, and answers exactly one
 * question: whose is this and what state is it in.
 *
 * Ranked, and only one shows. Ranks 1 and 2 are the two that are *news* — a
 * draft came back off disk, a fork is being written right now — and both
 * outrank the ownership lines, which describe a standing fact the reader
 * already knows and can go on knowing a few seconds longer.
 *
 * The `admin` line is keyed on the *stance* rather than on access alone — the
 * doc's table says "admin, not owner" unqualified, but "Du redigerer …"
 * printed over show mode would be a false sentence, and this slot exists to
 * say what state you are in.
 *
 * Rank 5 is the one that is permanent, and it is last for that reason: a copy
 * is a copy forever, so its line must never be what you read instead of
 * "somebody is editing this out from under you".
 */
const Banner = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t, i18n } = useTranslation();
  const owner = ws.locality.expand?.owner?.name;

  if (ws.restoredAt != null) {
    // Only the clock time. The buffer is keyed on the lokalitet and there is
    // at most one, so "which session was this" is not a question the author
    // has; "how long ago did I lose it" is, and the hour answers it.
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

  // Rank 2: the fork, while it is being written (§7). Counted rather than a
  // spinner, because copying forty funn over a slow link is long enough that
  // "is it stuck" is a real question, and the count answers it.
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

  // Rank 5: your own copy of somebody else's site. The label is frozen prose
  // rather than a live read through the relation, so it still says who made
  // the original after the original is gone — which is exactly when it
  // matters, and why `Åpne originalen` has to be allowed to fail.
  //
  // §7 puts "the original is gone" on each borrowed card, but a copy stores
  // nothing per borrowed file — only the one relation — so when the relation
  // stops resolving there are no cards to put it on. The sentence belongs to
  // the lokalitet, so it is said here, once, and the dead link is withdrawn
  // rather than left to fail on a press.
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
 * Depth 1's exits: `[Lagre] [Avbryt] [⋮]` (§5.3, §5.6).
 *
 * The pair the whole transaction is for. `Lagre` sends the buffer and drops
 * the stance without waiting for the pixels; `Avbryt` throws it away, and
 * asks first — but only when there is something to ask about. A confirm on an
 * empty buffer is a dialog that teaches the author to dismiss dialogs.
 *
 * The sentence names *work*, not writes, and that is the point of counting it
 * at all: "Forkast 12 bilder og 3 funn?" is a question about the afternoon,
 * where "3 endringer forkastes" would be a question about the network.
 */
const EditExits = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t, i18n } = useTranslation();
  const [confirming, setConfirming] = useState(false);
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

  const cancel = () => {
    if (!ws.dirty) {
      void ws.cancelEdit();
      return;
    }
    setConfirming(true);
  };

  return (
    <>
      <Button
        variant="primary"
        leftIcon="check"
        disabled={ws.saving}
        onClick={() => void ws.saveEdit()}
      >
        {t('localities.edit.save')}
      </Button>
      <Button
        variant="ghost"
        palette="gray"
        disabled={ws.saving}
        onClick={cancel}
      >
        {t('localities.edit.cancel')}
      </Button>
      <OverflowMenu ws={ws} />

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('localities.edit.discardTitle')}
        closeLabel={t('shared.close')}
        footer={
          <>
            <Button
              size="sm"
              palette="gray"
              onClick={() => setConfirming(false)}
            >
              {t('localities.edit.discardKeep')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              palette="red"
              onClick={() => {
                setConfirming(false);
                void ws.cancelEdit();
              }}
            >
              {t('localities.edit.discardConfirm')}
            </Button>
          </>
        }
      >
        <p className={rowStyles.discardBody}>
          {/* `Intl.ListFormat` rather than a joined string with an "og" in
              it: the conjunction is the one bit of this sentence the three
              locale files should not have to spell, and it is in the
              platform. */}
          {t('localities.edit.discardBody', {
            what: new Intl.ListFormat(i18n.language, {
              type: 'conjunction',
            }).format(parts),
          })}
        </p>
      </Dialog>
    </>
  );
};

/**
 * Terreng and Sammenlign, on the lokalitet row (docs/lokalitet-view.md §8).
 *
 * They read a rectangle and a second ground against the first, and neither is
 * a thing you can do to the bare map any more: Terreng's standalone entrance
 * is gone, and Sammenlign's only control left row 1 with it. Both are read
 * tools, so they render in both stances and unabridged for a reader.
 *
 * The ring behind them is still `useGroundMode`, mounted once in
 * `RibbonGlobalRow` — this reads the slice it publishes. `null` means row 1
 * has not rendered yet (or crashed inside its own error boundary), and two
 * buttons with nothing behind them are worse than a gap.
 */
const ReadTools = () => {
  const { t } = useTranslation();
  const ground = useAtomValue(groundHandleAtom);
  if (!ground) return null;
  return (
    <>
      {/* Digit 5 still selects it — the ring is a fact about GROUND_MODES,
          not about which row draws the button. The one ground that cannot be
          half of a comparison: it is a render over the whole map, not a
          background. Disabled rather than hidden while the curtain's right
          half has focus, so the row does not reflow as you flip A|B; a render
          already up on the left half stays up. */}
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
 * Row 2 — the open lokalitet, in three zones (docs/lokalitet-view.md §5.1).
 *
 * | left   | identity + the work | *where am I, what can I do to it* |
 * | centre | the terrain tools   | *what does this ground look like* |
 * | right  | the contents + exits| *what is in it, how do I get out* |
 *
 * That grammar is the point: your eye goes left to know where you are and
 * right to know what to press. The middle of the left cell is either empty
 * (show) or full of tools (edit), so the stance is legible from across the
 * room without reading a word. The tint is the confirmation, not the signal.
 *
 * A CSS grid of `1fr auto 1fr` rather than a flex row, and that is what buys
 * the centre: Terreng and Sammenlign sit on the row's own midpoint instead of
 * wherever the lokalitet's name happens to leave them, so the pair does not
 * shuffle sideways as you walk from "Storevike" to "Bjørnstad søndre".
 *
 * The split between centre and right is a split between *kinds* of tool, not
 * a way of filling three columns. Terreng and Sammenlign interrogate the
 * ground — they ask the rectangle what shape it is and hold two acquisitions
 * of it side by side — and they are answered by the data. `Funn` and `Bilder`
 * interrogate what a person put here, and they are answered by you. Two
 * different questions, two different places to point at, and the exits belong
 * with the second because leaving is also something you do rather than
 * something the ground does.
 *
 * The `[←]` back arrow is gone. Leaving is an exit, exits are on the right,
 * and one lokalitet should not have two ways out at opposite ends of a row.
 *
 * Still one line tall, but no longer a strip that owns nothing: with the dock
 * gone (§6) this row is where the lokalitet's contents are reached from —
 * `Funn` as a popover with its own eye, `Bilder ▾` folding the bottom edge,
 * `Detaljer` as a dialog off the `⋮`. That is the trade §6 makes: the bodies
 * are still not *in* the row, but they are one press from it and they cost
 * nothing when nobody is reading them, where the column cost 360 px of
 * terrain always.
 *
 * Terreng and Sammenlign are on it too (§8). Both are read tools, present in
 * both stances and unabridged for a reader, and row 1 no longer offers either.
 */
export const RibbonLocalityRow = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const { locality, stance, mayEdit, canAdd, mode } = ws;
  const [stripOpen, setStripOpen] = useAtom(bilderStripOpenAtom);
  const editing = stance === 'edit';

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

        {/* Everything that leaves a trace, and therefore nothing at all in show
            (§2). Gated on `canAdd` as a block rather than per button because
            every one of them creates content, so for an admin — who may edit
            this record but not add to it — the zone is empty and should not
            render its gap.

            In the left cell with identity, because a write verb is aimed at
            *this* record: it reads as "the lokalitet, and what I can add to
            it". The two inspection zones to the right of it are aimed at the
            ground and at what is already there. */}
        {canAdd && (
          <div className={rowStyles.tools}>
            <ModeButton
              icon="add"
              label={t('localities.funn.new')}
              tooltip={`${t('localities.funn.new')} (N)`}
              active={mode === 'draft'}
              onClick={() => (ws.draftActive ? ws.stopDraft() : ws.startDraft())}
            />
            {/* The general answer to "how do I add an image": whatever the map
                is showing, kept at the source's own resolution rather than
                photographed off the screen (docs/lokalitet-view.md §4.3). It
                stands in front of `Hent ▾` because that one opens pickers for a
                *different* dataset than the one you are looking at, and this is
                the one for the one you are.

                Disabled rather than hidden on Standard and Hybrid: neither can
                be fetched as data, and the tooltip says which verb can. Hiding
                it would make the row reflow as you walked the ground ring. */}
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

      {/* The centre cell, on the row's true midpoint: the two tools that
          interrogate the ground itself (§5.5). Both are present in **both**
          stances and in full for a reader, because looking is not writing —
          which is the whole argument of §2. Only their exits write, and those
          escalate on their own. */}
      <div className={rowStyles.terrain}>
        <ReadTools />
      </div>

      <div className={rowStyles.right}>
        {/* What a person put in this rectangle: the funn and the bilder, the
            two things that would not exist if nobody had come here. They are
            the counterpart to the centre cell rather than more of it, which is
            why they are over here beside the exits and not next to Terreng. */}
        <div className={rowStyles.contents}>
          <FunnControl ws={ws} />
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

        {/* The right zone, deepest-first (§5.3). The deepest thing in flight
            owns it, and everything shallower is hidden while that is open —
            which is what stops a row from offering to end two different things
            with two buttons that both say `Ferdig`.

            Depth 2 arrives here with the dock's removal: the funn draft and
            Juster området used to keep their own exits in a dock band, and now
            that both are gone from the column, this is where they go.

            `Lukk` is absent in edit — you leave the stance before you leave the
            record — and `Del` is absent everywhere until `?lok=CODE` exists,
            since a share button that shares nothing is worse than none. For a
            reader the `Rediger` slot is `Lag min kopi`, which arrives with the
            copy in step 14; until then that slot is empty rather than filled
            with a button that would lie. */}
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
              {/* Both arms since step 13. Nothing has been written either way,
                  so `Forkast funn` can forget a fresh funn and put an edited
                  one's old shape back — which is exactly what §5.3 asked for
                  and what autosave could not honestly offer. */}
              <Button
                variant="ghost"
                palette="red"
                leftIcon="undo"
                onClick={ws.discardDraft}
              >
                {t('localities.funn.draft.discard')}
              </Button>
            </>
          ) : ws.adjusting ? (
            /* §5.3's [Bruk] [Angre], and the transaction is what makes the
               second one possible: the rectangle moves in the buffer, not on
               the server, so `Angre` is a value being put back rather than a
               second PATCH. Nested inside the session rather than deferred to
               `Avbryt`, because you reshape the area in the middle of a
               session and taking one gesture back should not cost the nine
               images you kept before it. */
            <>
              <Button
                variant="primary"
                leftIcon="check"
                onClick={ws.applyAdjust}
              >
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
              {/* One slot, two honest labels (§3). `Rediger` costs nothing and
                  says so; `Lag min kopi` costs a record and says that. The
                  alternative — one button that quietly forks the site the
                  first time a reader types in a field — is the escalation
                  this design deleted. */}
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
              {/* §5.3 puts `[⋮]` in show too, and now it earns its place: it is
                  how a reader opens Detaljer. Its write verbs are gated
                  inside. */}
              <OverflowMenu ws={ws} />
            </>
          )}
        </div>
      </div>
    </div>
  );
};
