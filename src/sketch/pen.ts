/** The theme's papaya, the same orange the pin is drawn in. */
export const PEN_STROKE_COLOUR = '#ff6a00';

/** Only the tools that put something on the ground are remembered: Excalidraw
 *  reverts to `selection` by itself once a shape is finished. */
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

/** `locked` is Excalidraw's tool lock; without it a restored tool would last
 *  one stroke. */
export type Pen = { tool: PenTool; locked: boolean };

const STORAGE_KEY = 'sketchPen.v1';

const isPenTool = (value: string): value is PenTool =>
  (PEN_TOOLS as readonly string[]).includes(value);

const stored = (): Pen | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Pen>;
    // localStorage is reader-editable; an unknown tool would reach
    // `setActiveTool`.
    if (typeof parsed?.tool !== 'string' || !isPenTool(parsed.tool)) return null;
    return { tool: parsed.tool, locked: parsed.locked === true };
  } catch {
    return null;
  }
};

/** The stored value once it has been read. `undefined` means not yet. */
let known: Pen | null | undefined;

/** What the reader last reached for, or null if they have not drawn yet. */
export const rememberedPen = (): Pen | null => {
  if (known === undefined) known = stored();
  return known;
};

/** Called from Excalidraw's `onChange`, which fires on every pointer sample,
 *  so only a real change is written. */
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
