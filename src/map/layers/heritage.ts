import { atom } from 'jotai';
import {
  getUrlParameter,
  removeUrlParameter,
  setUrlParameter,
} from '../../shared/utils/urlUtils';

export const HERITAGE_DETAILS = [
  'lokaliteter',
  'enkeltminner',
  'sikringssoner',
] as const;

export type HeritageDetail = (typeof HERITAGE_DETAILS)[number];

export const HERITAGE_RENDERS = [
  'omriss',
  'flate',
  'fredede',
  'verneverdige',
  'listefoerte',
  'utenVern',
  'uavklart',
] as const;

export type HeritageRender = (typeof HERITAGE_RENDERS)[number];

export const HERITAGE_VERN_RENDERS = HERITAGE_RENDERS.slice(
  2,
) as readonly HeritageRender[];

type Sublayer = {
  name: string;

  styles: Partial<Record<HeritageRender, string>>;
};

const VERN: Partial<Record<HeritageRender, string>> = {
  fredede: 'fredede',
  verneverdige: 'verneverdige',
  listefoerte: 'listefoerte',
  utenVern: 'uten_vern',
  uavklart: 'uavklart',
};

const DETAIL_SUBLAYERS: Record<HeritageDetail, Sublayer[]> = {
  lokaliteter: [
    {
      name: 'Lokaliteter',
      styles: { omriss: '', flate: 'heldekkende', ...VERN },
    },

    {
      name: 'Lokalitetsikoner',
      styles: { omriss: '', flate: '', ...VERN, uavklart: 'Uavklart' },
    },
  ],
  enkeltminner: [

    {
      name: 'Enkeltminner',
      styles: { omriss: 'grenser', flate: 'inspire_common:DEFAULT', ...VERN },
    },
    { name: 'Enkeltminneikoner', styles: { omriss: '', flate: '', ...VERN } },
  ],
  sikringssoner: [

    {
      name: 'Sikringssoner',
      styles: { omriss: 'inspire_common:DEFAULT', flate: 'heldekkende' },
    },
  ],
};

const PAINT_ORDER: readonly string[] = [
  'Sikringssoner',
  'Lokaliteter',
  'Enkeltminner',
  'Lokalitetsikoner',
  'Enkeltminneikoner',
];

export const heritageSitesParams = (
  details: ReadonlySet<HeritageDetail>,
  render: HeritageRender,
): { LAYERS: string; STYLES: string } | null => {
  const picked: { name: string; style: string }[] = [];
  for (const detail of HERITAGE_DETAILS) {
    if (!details.has(detail)) continue;
    for (const sublayer of DETAIL_SUBLAYERS[detail]) {
      const style = sublayer.styles[render];
      if (style === undefined) continue;
      picked.push({ name: sublayer.name, style });
    }
  }
  if (picked.length === 0) return null;
  picked.sort(
    (a, b) => PAINT_ORDER.indexOf(a.name) - PAINT_ORDER.indexOf(b.name),
  );
  return {
    LAYERS: picked.map((p) => p.name).join(','),
    STYLES: picked.map((p) => p.style).join(','),
  };
};

const readDetails = (): Set<HeritageDetail> => {
  const fromUrl = getUrlParameter('heritageDetails');
  if (fromUrl === null) return new Set(HERITAGE_DETAILS);
  const known = fromUrl
    .split(',')
    .filter((d): d is HeritageDetail =>
      (HERITAGE_DETAILS as readonly string[]).includes(d),
    );
  return new Set(known);
};

const readRender = (): HeritageRender => {
  const fromUrl = getUrlParameter('heritageRender');
  return (HERITAGE_RENDERS as readonly string[]).includes(fromUrl ?? '')
    ? (fromUrl as HeritageRender)
    : 'omriss';
};

export const MIN_HERITAGE_OPACITY = 0.2;

const readOpacity = (): number => {

  const raw = getUrlParameter('heritageOpacity');
  const value = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(MIN_HERITAGE_OPACITY, value));
};

export const heritageDetailsAtom = atom<Set<HeritageDetail>>(readDetails());

export const heritageRenderAtom = atom<HeritageRender>(readRender());

export const heritageOpacityAtom = atom<number>(readOpacity());

export const heritageHiddenAtom = atom(false);

export const writeHeritageUrlParameters = (
  details: ReadonlySet<HeritageDetail>,
  render: HeritageRender,
  opacity: number,
): void => {
  if (details.size === HERITAGE_DETAILS.length) {
    removeUrlParameter('heritageDetails');
  } else {
    setUrlParameter(
      'heritageDetails',
      HERITAGE_DETAILS.filter((d) => details.has(d)).join(','),
    );
  }
  if (render === 'omriss') removeUrlParameter('heritageRender');
  else setUrlParameter('heritageRender', render);
  if (opacity >= 1) removeUrlParameter('heritageOpacity');
  else setUrlParameter('heritageOpacity', opacity.toFixed(2));
};
