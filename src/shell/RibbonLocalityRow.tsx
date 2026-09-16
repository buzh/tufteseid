import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { ChangeEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalityRecord } from '../api/localities';
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

const VISIBILITY_PALETTE: Record<
  LocalityRecord['visibility'],
  BadgePalette
> = {
  private: 'gray',
  limited: 'yellow',
  public: 'green',
};

/*
 * Name display, inline rename, and — in show — zoom-to.
 *
 * A component of its own so the parent can key it on locality.id: without
 * that, swapping lokalitet shows the previous one's half-typed name, and a
 * fresh record does not re-open the field.
 *
 * The name is the row's one clickable noun and it means "this record", so it
 * carries whichever verb the stance has for that: rename in edit, frame it on
 * the map in show. That is what replaced the `⤢` button that used to sit at
 * the end of the identity zone — a whole control for a verb the thing beside
 * it could say by itself. Zoom keeps a second, stance-independent home in the
 * `⋮` menu, so it is still reachable while the name means rename.
 *
 * A real <button> inside the heading rather than a click handler on the <h2>:
 * the control it replaced was keyboard-reachable and this one has to stay so.
 */
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
          /* Zoom-to, in both stances and for everybody. The name in the
             identity zone is the fast way to it, but only while it is not
             busy meaning rename — so the verb keeps one place that does not
             depend on which stance you are in. */
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
          /* `Del` — the link to this lokalitet (docs/lokalitet-view.md §10).
             Both stances and every access level: a reader sharing on a
             lokalitet they were shown is the ordinary case, and the link
             grants nothing the recipient does not already have. It is a menu
             item rather than a surface of its own because it is one
             clipboard write, and it sits beside the short code it is made
             of — `LocalityCode` copies the six characters for a phone call,
             this copies the URL for a message.

             The toast names the visibility consequence rather than the menu
             hiding the verb on a private record: "nobody else can open this"
             is a fact about the lokalitet worth being told, and a `Del` that
             silently is not there teaches nothing. */
          {
            icon: 'share',
            label: t('localities.share.copyLink'),
            disabled: !ws.locality.code,
            onSelect: () => copyShareLink(ws.locality),
          },
          /* `Rapportpakke` — the whole lokalitet as a zip
             (docs/lokalitet-view.md §9). Both stances and every access level,
             like `Del` and for the same reason: handing somebody a report of
             a site you were shown is the ordinary case, and a bundle is a
             read. The one write inside it — forcing a pin on a View that has
             no pixels yet — is gated on `canAdd` in `runTakeout`, so a
             reader's bundle carries what exists and its front page names
             what does not.

             Named `Rapportpakke` rather than `pakke`: "grunnpakke" is
             already the starter set's word, and two unrelated pakker in one
             menu is a collision that costs nothing to avoid. */
          {
            icon: 'folder_zip',
            label: t('localities.takeout.action'),
            disabled: ws.takeoutProgress != null,
            onSelect: () => void ws.runTakeout(),
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
 * `[Funn ▾]` — docs/lokalitet-view.md §5.5, §6, and §13.10 step 4, which is
 * what re-clothed it. The top of the map's z-stack (`funnLayer`, zIndex 5) and
 * therefore the rightmost of the row's layer groups.
 *
 * It was an `EyeSplit`: the labelled half opened the index and an eye welded
 * to it took the funn off the map. It is now a `LayerGroup`, which is the same
 * two hit targets with the duties **swapped** — the label is the switch (`H`
 * unchanged) and a caret opens the index. That is a real cost paid once: the
 * press this control has taught for a while now does something else. What it
 * buys is the row reading left to right as the stack reads bottom to top,
 * every group answering its label press the same way, and this button no
 * longer being the one exception to a rule the other three state.
 *
 * The index itself is untouched, and that is step 4's other half. A funn is
 * not only a layer — it is a record you rename, restage, redraw and delete —
 * so `[Funn]` brings `FunnList` as its pulldown body rather than pretending
 * its rows are the generic member rows beside a sketch's. What it gained is
 * the one thing that *is* generic: a switch per row.
 *
 * Closing on select is right rather than rude: you asked for a funn, so the
 * map has flown to it and the note is up beside the shape in `FunnCallout`.
 * A popover and not a dock is the whole bet of §6 — this is a thing you
 * consult a few times a session, and it was costing 360 px of terrain
 * permanently for the privilege.
 *
 * **No opacity, per member or per group, and that is decided rather than
 * deferred.** Per-funn opacity does not fall out of one vector layer: it is N
 * layers or a style function, for a knob that would be aimed at the wrong
 * thing anyway. The funn style is *already* built not to cover the ground it
 * marks — a cased outline with a 0.12 fill, because the relief under a funn is
 * the evidence for it (`funnLayer.ts`) — so what fading elsewhere buys, this
 * layer bought at the style. What is left is on and off, and that has a
 * switch, a group label and a key.
 *
 * Both stances, and the switches are not gated either: reading your own index
 * is not writing to it and neither is taking a mark off the relief. `editable`
 * still decides whether the rows offer the verbs (§2).
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

  // What is on the map: the index minus this session's tombstones, which are
  // already off it (`removeFunn`), minus the ones switched off by hand.
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
 * `[Skisse ▾]` — the first of the layer row's four groups
 * (docs/lokalitet-view.md §13.1, §13.10 step 3).
 *
 * Skisse first because its data is already exactly the shape the row assumes:
 * a *set* of members, declared as a whole (`setSketchOverlays`), each its own
 * layer. The other three have to be reshaped before they can be listed, so
 * landing the control here made the step the control and per-member opacity
 * and nothing else.
 *
 * Its place in the row is its place in the stack — sketches are at `zIndex: 2`
 * and the funn layer at 5, so [Skisse] goes to the left of `Funn`, and
 * [Visning] and [Bilde] are to the left of it. That ordering is the row's one
 * teaching claim (§13.1) and it is cheap to keep.
 *
 * Absent rather than disabled on a lokalitet with no sketches. A group control
 * over nothing is a button that cannot answer the only question it is asked —
 * and `[Funn ▾]` beside it is the group that is always there, so the row is
 * never empty of one.
 *
 * The card's own eye (`SketchToggleButton`) is untouched and still correct —
 * both press the same set, so the rail and the row cannot disagree.
 *
 * Step 9 grouped it by funn (§13.6), which this group had the most claim to:
 * `funn` has meant "what this drawing is about" since 1700000700 and was
 * already seeded from the selected funn, so the tracings of a pit have been
 * filed under it all along with nothing showing that. The paint order follows
 * the same list — `useLocalityWorkspace`'s overlay effect walks
 * `orderedByFunn` for exactly that reason (§13.1).
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
      // The caption is the author's own name for the drawing and is seeded
      // "Skisse n" at `Behold skissen`, so it is nearly always there. The
      // fallback counts this list rather than the record, because a numbering
      // that skips is worse than one that does not match a caption nobody
      // wrote.
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
          onToggleMember={ws.toggleSketch}
          onSetOpacity={ws.setSketchOpacity}
        />
      )}
    </LayerGroup>
  );
};

/*
 * The banner slot — docs/lokalitet-view.md §5.7. It occupies the space the
 * summary used to, holds at most one sentence, and answers exactly one
 * question: whose is this and what state is it in.
 *
 * Ranked, and only one shows. Ranks 1 to 3 are the ones that are *news* — a
 * draft came back off disk, a fork is being written right now, a Rapportpakke
 * is being built — and all three outrank the ownership lines, which describe a
 * standing fact the reader already knows and can go on knowing a few seconds
 * longer.
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

  // Rank 3: the Rapportpakke being built (§9). Below the fork because a fork
  // is writing records and this is only reading them, and above the ownership
  // lines for the same reason rank 2 is — it is news, and it ends.
  //
  // Counted in two acts, because the first one can be much the longer: pinning
  // the Views that have no pixels yet is a tile burst per image, where
  // fetching the files that do is a download. Naming which act it is in is the
  // difference between "this is slow" and "this is stuck".
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
 * Depth 1's exits: `[Lagre] [Avbryt] [Avslutt] [⋮]` (§5.3, §5.6).
 *
 * Three verbs on two axes. `Lagre` and `Avbryt` are about the **buffer** —
 * send it, or throw it away — and neither one ends the session; `Avslutt` is
 * about the **stance**, and is the only one that does. Saving used to be the
 * way out, which made every commit a round trip through show and back
 * `Rediger` again: a session that wanted its last hour on the server had to
 * end to get it there.
 *
 * `Avbryt` is *absent* on a clean buffer rather than greyed, because there is
 * nothing to cancel and a live-looking button that undoes nothing is one to
 * be afraid of. `Lagre` stays and greys, because a third button appearing and
 * disappearing under the cursor on every keystroke is worse than a dull one.
 *
 * Both dialogs name *work*, not writes, and that is the point of counting it
 * at all: "Forkast 12 bilder og 3 funn?" is a question about the afternoon,
 * where "3 endringer forkastes" would be a question about the network.
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

  /* `Intl.ListFormat` rather than a joined string with an "og" in it: the
     conjunction is the one bit of this sentence the three locale files should
     not have to spell, and it is in the platform. */
  const what = new Intl.ListFormat(i18n.language, {
    type: 'conjunction',
  }).format(parts);

  const close = () => setConfirming(null);

  // The exit asks the same question `Avbryt` does and offers one more answer:
  // most of the time an author on their way out meant to keep the work, and
  // making them press `Lagre` and then `Avslutt` to say so is making them
  // press twice for the common case.
  const exit = () => {
    if (!ws.dirty) void ws.exitEdit();
    else setConfirming('exit');
  };

  const saveAndExit = async () => {
    close();
    // Only on a clean commit: a half-failed save leaves the remainder in the
    // buffer, and walking out of the stance would strand it there.
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

      {/* …and the same question on the way out, with the answer an author
          usually means. `Lagre og avslutt` is the primary; the destructive arm
          is spelled out rather than being what the dialog does by default. */}
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

  /*
   * The pen goes up if this row stops being able to put it up.
   *
   * While the surface is covering the map, this row holds the only way out of
   * it — row 1 is inert and the surface takes the keyboard
   * (src/funn/FunnCanvas.tsx). So losing the right to add has to end the
   * session on the way past rather than merely hiding the exit. Closing or
   * switching lokalitet is the workspace's own cleanup, since that is what
   * unmounts this row.
   *
   * The row going away on its own is the third case and it is the one with no
   * way back: the `ErrorBoundary` around this row can take it off the screen
   * while the workspace above it lives on, and that leaves the surface over a
   * frozen map with every exit gone. So it also goes up when this unmounts —
   * through a ref, because `putPenDown` is rebound when a funn draft arms and
   * a cleanup keyed on it would put the pen down mid-stroke.
   */
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
            onZoom={ws.zoomToLocality}
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
        </div>

        {/* What a person put in this rectangle: the funn and the bilder, the
            two things that would not exist if nobody had come here. Beside the
            identity rather than out by the exits, because they describe *this
            record* the way the name and the code do — the centre cell is the
            one aimed at the ground instead.

            In front of the write verbs, not behind them, so the pair keeps its
            place when `.tools` appears and disappears with the stance: pressing
            `Rediger` must not move `Funn` out from under the pointer. */}
        <div className={rowStyles.contents}>
          {/* Left to right is bottom to top of the map's z-stack
              (docs/lokalitet-view.md §13.1): the ground and the Views over it,
              the Files over those, then the sketches at zIndex 2 and the funn
              at 5. All four groups are here as of §13.10 step 6. */}
          <VisningControl ws={ws} />
          <BildeControl ws={ws} />
          <SkisseControl ws={ws} />
          <FunnControl ws={ws} />
          {/* The drawer, and only the drawer. It used to light for "a bilde
              is on the ground" and press shut to take that bilde off — the
              one thing about `Bilder` that changed what you were looking at,
              on a button whose other half is a bar across the bottom of the
              screen.

              Step 6 gave that reading to four group labels that each answer
              it about a layer they actually own, so this button is back to
              the question a rail is for: is there anything here, and do I
              want to see it. Nothing it does touches the map, so nothing it
              shows needs to be lit — the bar's own presence is the state. */}
          <ModeButton
            icon="photo_library"
            label={t('localities.bilder.heading')}
            tooltip={t(
              stripOpen
                ? 'localities.bilder.hideStrip'
                : 'localities.bilder.showStrip',
            )}
            badge={ws.bilderCount || undefined}
            // Nothing to show and no way to put anything there: a reader on an
            // empty lokalitet. The button would open an empty bar.
            disabled={!ws.hasBilder}
            onClick={() => setStripOpen(!stripOpen)}
          />
        </div>

        {/* Everything that leaves a trace, and therefore nothing at all in show
            (§2). Gated on `canAdd` as a block rather than per button because
            every one of them creates content, so for an admin — who may edit
            this record but not add to it — the zone is empty and should not
            render its gap.

            Last in the left cell, so it reads left to right as the record, what
            is in it, and what I can put in it next — three statements about the
            same lokalitet, with the ground tools in the middle of the row and
            the ways out at the end of it. */}
        {canAdd && (
          <div className={rowStyles.tools}>
            <ModeButton
              icon="add"
              label={t('localities.funn.new')}
              tooltip={`${t('localities.funn.new')} (N)`}
              active={mode === 'draft'}
              onClick={() => (ws.draftActive ? ws.stopDraft() : ws.startDraft())}
            />
            {/* The other thing the same pen makes (§9.3): a transparent
                overlay, kept as its strokes rather than converted to geometry.
                Two buttons rather than a mode switch on one, because which of
                the two you are making decides what the tools are *for* — a
                funn is a claim about the ground and a sketch is a reading of
                an image, and nothing about a drawing says which it was meant
                to be. It is also its own exit: row 1 goes inert while the pen
                is down and this row does not. */}
            <ModeButton
              icon="draw"
              label={t('localities.tools.draw')}
              tooltip={t('localities.tools.drawHint')}
              active={ws.sketchActive}
              onClick={() =>
                ws.sketchActive ? ws.stopSketch() : ws.startSketch()
              }
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
            {/* …and the same verb one level up: `Behold` keeps the ground,
                this keeps the stack over it (§13.7). Beside it rather than in
                the layer row because §13.8's rule is that nothing in the row
                writes — the row is where an arrangement is made, and keeping
                one is authorship.

                Disabled when there is nothing on the map to keep, which is
                the honest state rather than a hidden button: an empty stack
                over an unkeepable ground is a blank sheet with a caption. */}
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

      {/* The centre cell, on the row's true midpoint: the two tools that
          interrogate the ground itself (§5.5). Both are present in **both**
          stances and in full for a reader, because looking is not writing —
          which is the whole argument of §2. Only their exits write, and those
          escalate on their own. */}
      <div className={rowStyles.terrain}>
        <ReadTools />
      </div>

      {/* The right cell, and since the contents moved over to the left it holds
          nothing but the ways out — which is what a right edge is for.

          Deepest-first (§5.3): the deepest thing in flight owns the zone, and
          everything shallower is hidden while that is open —
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
        ) : ws.sketchActive ? (
          /* The sketch's own pair, and the asymmetry with the funn draft above
             is the point: a funn is committed stroke by stroke to the buffer
             as it is drawn, so its exit is `Ferdig`; a sketch is not written
             anywhere until this button, so its exit is `Behold skissen`. The
             ghost arm is `Avbryt` rather than `Forkast`, for the same reason —
             there is nothing yet to forget. */
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
  );
};
