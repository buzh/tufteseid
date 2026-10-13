export const PEN_STROKE_COLOUR = '#ff6a00';

export const SHAPE_TOOLS = ['ellipse', 'rectangle', 'diamond'] as const;
export const LINEAR_TOOLS = ['arrow', 'line'] as const;

export type ShapeTool = (typeof SHAPE_TOOLS)[number];
export type LinearTool = (typeof LINEAR_TOOLS)[number];

export const PEN_COLOURS = [
  { value: PEN_STROKE_COLOUR, name: 'papaya' },
  { value: '#ffffff', name: 'white' },
  { value: '#1e1e1e', name: 'black' },
  { value: '#e03131', name: 'red' },
  { value: '#1971c2', name: 'blue' },
  { value: '#22b8cf', name: 'cyan' },
] as const;

export const PEN_WIDTHS = [
  { value: 1, name: 'thin' },
  { value: 2, name: 'bold' },
  { value: 4, name: 'extraBold' },
] as const;

export type Pen = {
  locked: boolean;
  shape: ShapeTool;
  linear: LinearTool;
  colour: string;
  width: number;
};

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
  } catch {}
};

const isShape = (type: string): type is ShapeTool =>
  (SHAPE_TOOLS as readonly string[]).includes(type);

const isLinear = (type: string): type is LinearTool =>
  (LINEAR_TOOLS as readonly string[]).includes(type);

export const rememberTool = (type: string, locked: boolean) =>
  write({
    locked,
    ...(isShape(type) ? { shape: type } : {}),
    ...(isLinear(type) ? { linear: type } : {}),
  });

export const rememberStroke = (colour: string, width: number) =>
  write({ colour, width });
