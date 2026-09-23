// The service root, without the operation: OL appends that itself.
export const FLYFOTO_PROJECT_IMAGESERVER =
  '/arcgis/nib/ortofoto_prosjekter/ImageServer';

// SQL apostrophe escape; a few project names have one.
const flyfotoProjectWhere = (projectId: string): string =>
  `prosjektnavn='${projectId.replace(/'/g, "''")}'`;

// `esriMosaicNone`: the default by-date method blends neighbouring projects in.
export const flyfotoMosaicRule = (projectId: string): string =>
  JSON.stringify({
    mosaicMethod: 'esriMosaicNone',
    where: flyfotoProjectWhere(projectId),
  });
