export const isNumberOk = (value: number | undefined): boolean => {
  return value != null && !isNaN(value) && isFinite(value);
};
