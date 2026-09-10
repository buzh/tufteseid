// Conditional className joiner. Every component in src/ui/ takes an optional
// `className` so call sites can add layout without a wrapper div.
export const cx = (
  ...parts: (string | false | null | undefined)[]
): string | undefined => {
  const joined = parts.filter(Boolean).join(' ');
  return joined || undefined;
};
