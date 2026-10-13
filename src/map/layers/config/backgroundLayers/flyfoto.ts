export const FLYFOTO_PROJECT_IMAGESERVER =
  '/arcgis/nib/ortofoto_prosjekter/ImageServer';

const flyfotoProjectWhere = (projectId: string): string =>
  `prosjektnavn='${projectId.replace(/'/g, "''")}'`;

export const flyfotoMosaicRule = (projectId: string): string =>
  JSON.stringify({
    mosaicMethod: 'esriMosaicNone',
    where: flyfotoProjectWhere(projectId),
  });
