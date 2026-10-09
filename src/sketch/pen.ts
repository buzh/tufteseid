/** The theme's papaya, the same orange the pin is drawn in. */
export const PEN_STROKE_COLOUR = '#ff6a00';

/** The two buttons that stand for a group rather than a tool, opened by
 *  holding. First in each is the default. */
export const SHAPE_TOOLS = ['ellipse', 'rectangle', 'diamond'] as const;
export const LINEAR_TOOLS = ['arrow', 'line'] as const;

export type ShapeTool = (typeof SHAPE_TOOLS)[number];
export type LinearTool = (typeof LINEAR_TOOLS)[number];

/** Only what the strip offers; a scene may carry any colour, an eyedropper's
 *  among them. Chosen to hold over both a grey hillshade and a green
 *  ortofoto. */
export const PEN_COLOURS = [
  { value: PEN_STROKE_COLOUR, name: 'papaya' },
  { value: '#ffffff', name: 'white' },
  { value: '#1e1e1e', name: 'black' },
  { value: '#e03131', name: 'red' },
  { value: '#1971c2', name: 'blue' },
  { value: '#22b8cf', name: 'cyan' },
] as const;

/** Excalidraw's own three, thinnest first: `STROKE_WIDTH` is not a package
 *  export. Thinnest is the default, a 4 px stroke covering two metres of
 *  ground. */
export const PEN_WIDTHS = [
  { value: 1, name: 'thin' },
  { value: 2, name: 'bold' },
  { value: 4, name: 'extraBold' },
] as const;

/** Everything the toolbox carries between sessions. The tool itself is not
 *  among them: every canvas opens on the hand (`SketchCanvas`). */
export type Pen = {
  /** Excalidraw's tool lock; without it a tool picked off the strip would last
   *  one stroke. */
  locked: boolean;
  /** Which member each grouped button currently stands for. */
  shape: ShapeTool;
  linear: LinearTool;
  colour: string;
  width: number;
};

// Read by the v1 parser below as well: every field is checked on its own, so a
// record written before the groups and the stroke existed upgrades in place.
const STORAGE_KEY = 'sketchPen.v1';

const DEFAULT_PEN: Pen = {
  locked: false,
  shape: SHAPE_TOOLS[0],
  linear: LINEAR_TOOLS[0],
  colour: PEN_STROKE_COLOUR,
  width: PEN_WIDTHS[0].value,
};

const HEX = /^#[0-9a-f]{6}$/i;

const oneOf = <T extends string>(
  options: readonly T[],
  value: unknown,
): T | undefined =>
  typeof value === 'string'
    ? options.find((option) => option === value)
    : undefined;

const stored = (): Pen => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PEN;
    const parsed = JSON.parse(raw) as Partial<Pen>;
    // localStorage is reader-editable and all of this reaches Excalidraw: an
    // unknown group member would go to `setActiveTool`, and a colour it cannot
    // parse draws nothing at all.
    return {
      locked: parsed?.locked === true,
      shape: oneOf(SHAPE_TOOLS, parsed?.shape) ?? DEFAULT_PEN.shape,
      linear: oneOf(LINEAR_TOOLS, parsed?.linear) ?? DEFAULT_PEN.linear,
      colour:
        typeof parsed?.colour === 'string' && HEX.test(parsed.colour)
          ? parsed.colour
          : DEFAULT_PEN.colour,
      width:
        PEN_WIDTHS.find((w) => w.value === parsed?.width)?.value ??
        DEFAULT_PEN.width,
    };
  } catch {
    return DEFAULT_PEN;
  }
};

let known: Pen | undefined;

/** What the reader last reached for. */
export const rememberedPen = (): Pen => (known ??= stored());

const write = (next: Partial<Pen>) => {
  const current = rememberedPen();
  const merged = { ...current, ...next };
  if (
    merged.locked === current.locked &&
    merged.shape === current.shape &&
    merged.linear === current.linear &&
    merged.colour === current.colour &&
    merged.width === current.width
  ) {
    return;
  }
  known = merged;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(known));
  } catch {
    // Quota or unavailable storage: a forgotten pen costs one click.
  }
};

const isShape = (type: string): type is ShapeTool =>
  (SHAPE_TOOLS as readonly string[]).includes(type);

const isLinear = (type: string): type is LinearTool =>
  (LINEAR_TOOLS as readonly string[]).includes(type);

/** From `onChange`, which fires on every pointer sample, so only a real change
 *  is written. Picking a group member is what makes it the one its button
 *  stands for; the flyout makes no call of its own. */
export const rememberTool = (type: string, locked: boolean) =>
  write({
    locked,
    ...(isShape(type) ? { shape: type } : {}),
    ...(isLinear(type) ? { linear: type } : {}),
  });

/** From `onChange` as well, so a colour taken with the eyedropper or carried
 *  in by paste-styles is remembered like one pressed on the strip. */
export const rememberStroke = (colour: string, width: number) =>
  write({ colour, width });
