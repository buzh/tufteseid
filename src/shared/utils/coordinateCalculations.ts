export const decimalToDMS = (dec: number) => {
  const sign = dec < 0 ? -1 : 1;
  const abs = Math.abs(dec);

  let deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  let min = Math.floor(minFloat);
  let sec = (minFloat - min) * 60;

  sec = Math.round(sec * 1000) / 1000;
  if (sec >= 60) {
    sec -= 60;
    min += 1;
  }
  if (min >= 60) {
    min -= 60;
    deg += 1;
  }

  return { deg, min, sec, sign };
};
