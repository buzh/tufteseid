/// <reference path="../pb_data/types.d.ts" />
//
// Everything the identity handler needs, in a module it requires rather than
// at the top of the `.pb.js` file beside it. PocketBase runs each handler in
// a runtime of its own, where the scope of the file it was written in is
// simply not there — `pb_hooks/closed_beta.js` has the long version.
//
// Not named `*.pb.js`: that suffix is what PocketBase loads as hooks, and
// this file registers none.

/** The Casdoor role whose members are administrators here. Casdoor reports
 *  role *names*, not the `organization/name` ids its console URLs carry. */
const ADMIN_ROLE = 'admin';

/** `rawUser.roles` is a Go slice handed to the JS runtime, so it answers to
 *  `length` and to an index and to nothing else — not `includes`. */
const holdsRole = (roles, wanted) => {
  const count = roles ? roles.length || 0 : 0;
  for (let i = 0; i < count; i++) {
    if (String(roles[i]) === wanted) return true;
  }
  return false;
};

/**
 * What the identity provider says this reader is. Casdoor lists their roles
 * in its userinfo response under the `profile` scope, which PocketBase's OIDC
 * provider asks for, and PocketBase keeps the whole response on `rawUser`.
 *
 * A reader holding no role at all is reported by leaving `roles` out of the
 * response rather than by sending it empty, so an absent key and an empty one
 * cannot be told apart and both read as `user`. Which is why this is a mirror
 * and not a merge: see `docs/identity.md` for what that costs on the way in.
 */
const roleFromClaims = (oAuth2User) => {
  const raw = oAuth2User ? oAuth2User.rawUser : null;
  const roles = raw ? raw['roles'] : null;
  return holdsRole(roles, ADMIN_ROLE) ? 'admin' : 'user';
};

/** Writes only on a difference, so that signing in is not by itself a reason
 *  to move `updated`. */
const applyRole = (app, record, role) => {
  if (!record || record.getString('role') === role) return;
  record.set('role', role);
  app.save(record);
};

module.exports = { roleFromClaims, applyRole };
