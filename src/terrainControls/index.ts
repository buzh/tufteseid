// The Terrenganalyse control surface, and it has two hosts.
//
// `TerrainToggle` stands in the band's tool section and is the whole on/off
// control. `TerrainSurface` is mounted by `MapComponent` and is the analysis
// itself — the controller, the DEM, and the box of settings floating on the
// map. Neither takes anything from its host: the two meet in
// `terrainWindowAtom`, which is the rectangle and the on switch both.
//
// `TerrainSurface` is mounted once and nowhere else. A second would be a second
// DEM, a second horizon scan and a second canvas over the same ground.
export { TerrainSurface } from './TerrainSurface';
export { TerrainToggle } from './TerrainToggle';
