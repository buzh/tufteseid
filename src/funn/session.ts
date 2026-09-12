import { atom } from 'jotai';
// Type-only, both of them: `drawEnabledAtom` reads this module, so anything
// it pulls in at runtime joins the graph the map is built from.
import type Map from 'ol/Map';
import type Interaction from 'ol/interaction/Interaction';
import type { FunnSnapshot } from './snapshot';

/*
 * A drawing session: the map stopped, photographed, and handed to Excalidraw.
 *
 * Non-null exactly while the surface is up, which is what the rest of the
 * chrome reads to stand down — the ribbon's global row goes inert, the left
 * and right slots get out of the way. The snapshot inside it is the frozen
 * pixels and the frame that gives them coordinates (`frame.ts`).
 *
 * Note the asymmetry with `funnDraftActiveAtom`: the pen going down starts a
 * session, but there is a wait in between while the map settles, and the
 * capture can fail. `funnDraftActiveAtom` is "the user asked"; this is "the
 * map is frozen and the surface is live". Only the second one may be used to
 * decide that something else is inop.
 */
export const funnSessionAtom = atom<FunnSnapshot | null>(null);

/*
 * The freeze itself.
 *
 * Every interaction that was live goes inactive and is remembered, rather
 * than the map being rebuilt or the viewport covered: the drawing surface is
 * transparent over the real map and has to stay in register with it, so a
 * single pan would put every stroke in the wrong place.
 *
 * Blunter than `map/interactions.ts`'s owner tagging on purpose. That registry
 * exists so one feature can remove its own interactions without disturbing
 * another's; this has the opposite requirement — *nothing* may move the view,
 * including the pan and zoom OpenLayers installs by default, which no owner
 * ever claimed.
 *
 * Module-level rather than an atom because it is not state anybody renders,
 * and because the thaw has to be able to run from an effect cleanup after the
 * component holding it has gone.
 */
let frozen: Interaction[] | null = null;

export const freezeMap = (map: Map) => {
  if (frozen) return;
  frozen = map
    .getInteractions()
    .getArray()
    .filter((interaction) => interaction.getActive());
  frozen.forEach((interaction) => interaction.setActive(false));
};

export const thawMap = (map: Map) => {
  if (!frozen) return;
  const was = frozen;
  frozen = null;
  // Only the ones still on the map. An interaction removed while the pen was
  // down — the measure tool's, say — must not be woken up off the map.
  const live = map.getInteractions().getArray();
  was.forEach((interaction) => {
    if (live.includes(interaction)) interaction.setActive(true);
  });
};
