// What the pen is holding when the canvas opens.
//
// Two things, and they are remembered differently on purpose. The colour is a
// default: every drawing starts in the app's orange, because what is being
// drawn is a reading of the terrain under it and Excalidraw's near-black is
// the one colour hillshade already is. The tool is a memory: a reader who
// traced a mound freehand last time is about to trace one again, and having to
// find the same button every visit is the kind of friction that ends with the
// drawing not being made.

/**
 * The orange the pin is drawn in (`spots/pinStyle.ts`), which is the theme's
 * papaya. Not in Excalidraw's own five swatches, so the picker shows it as the
 * custom colour it is — the point is that it is this app's accent, and a
 * stroke over relief should read as belonging to the same hand as the pin it
 * is beside.
 */
export const PEN_STROKE_COLOUR = '#ff6a00';

/**
 * The tools worth coming back to: the ones that put something on the ground.
 * `selection` is not among them and neither are `hand`, `eraser` or `laser` —
 * Excalidraw reverts to `selection` by itself the moment a shape is finished,
 * so remembering that would be remembering nothing, and arming a session with
 * an eraser would be handing the reader the one tool that can only take away.
 */
const PEN_TOOLS = [
  'freedraw',
  'line',
  'arrow',
  'rectangle',
  'diamond',
  'ellipse',
  'text',
] as const;

export type PenTool = (typeof PEN_TOOLS)[number];

/** Whether the tool lock is on with it: without that, Excalidraw drops back to
 *  selection after one shape, and a remembered tool would last one stroke. */
export type Pen = { tool: PenTool; locked: boolean };

const STORAGE_KEY = 'sketchPen.v1';

const isPenTool = (value: string): value is PenTool =>
  (PEN_TOOLS as readonly string[]).includes(value);

const stored = (): Pen | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Pen>;
    // Checked rather than trusted: this is a string a reader can edit, and an
    // unknown tool type would be handed to `setActiveTool` as if it were one.
    if (typeof parsed?.tool !== 'string' || !isPenTool(parsed.tool)) return null;
    return { tool: parsed.tool, locked: parsed.locked === true };
  } catch {
    return null;
  }
};

/** The stored value once it has been read. `undefined` means not yet. */
let known: Pen | null | undefined;

/**
 * What the reader last reached for, or null for a reader who has not drawn
 * yet — who gets Excalidraw's own selection tool, because a canvas that opens
 * armed is a canvas that marks the map on the first stray click.
 */
export const rememberedPen = (): Pen | null => {
  if (known === undefined) known = stored();
  return known;
};

/**
 * Called with every tool the reader picks. The ones above are kept and the
 * rest ignored — and the write only happens when something changed, because
 * the caller is `onChange`, which fires on every pointer sample.
 */
export const rememberPen = (tool: string, locked: boolean) => {
  if (!isPenTool(tool)) return;
  const current = rememberedPen();
  if (current?.tool === tool && current.locked === locked) return;
  known = { tool, locked };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(known));
  } catch {
    // Ignore quota / unavailable storage: a forgotten tool costs one click.
  }
};
