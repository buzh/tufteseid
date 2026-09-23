export const cx = (
  ...parts: (string | false | null | undefined)[]
): string | undefined => {
  const joined = parts.filter(Boolean).join(' ');
  return joined || undefined;
};
