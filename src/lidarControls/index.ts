// The LiDAR control surface, for whatever wants to host it. Three exports and
// no more: the group, the controller it takes, and the controller's type.
//
// The four controls inside are not exported. They are a set — the order and the
// dimming between them carry as much as any one of them does (see
// `LidarControlGroup`) — and a host picking two of them would get a surface
// that lies about who chose what.
export { LidarControlGroup } from './LidarControlGroup';
export { type LidarControls, useLidarControls } from './useLidarControls';
