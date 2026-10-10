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
 *  role *names*, not the `organization/name` ids its console URLs carry, and
 *  the same goes for the permission names below. */
const ADMIN_ROLE = 'admin';

/** `rawUser.roles` and `rawUser.permissions` are Go slices handed to the JS
 *  runtime, so they answer to `length` and to an index and to nothing else —
 *  not `includes`, not `map`. Sorted because Casdoor's order is not promised
 *  and a reshuffle is not a change worth a write. */
const names = (slice) => {
  const count = slice ? slice.length || 0 : 0;
  const out = [];
  for (let i = 0; i < count; i++) out.push(String(slice[i]));
  return out.sort();
};

/**
 * What the identity provider says this reader is and may spend. Casdoor lists
 * both in its userinfo response under the `profile` scope, which PocketBase's
 * OIDC provider asks for, and PocketBase keeps the whole response on
 * `rawUser`. `permissions` carries a permission's *name* and resolves through
 * roles and role hierarchy, so the tiers are Casdoor's to arrange and no name
 * here is known to this file.
 *
 * A reader holding none of either is reported by leaving the key out rather
 * than by sending it empty, so an absent key and an empty one cannot be told
 * apart and both read as nothing held. Which is why this is a mirror and not a
 * merge: see `docs/identity.md` for what that costs on the way in.
 */
const fromClaims = (oAuth2User) => {
  const raw = oAuth2User ? oAuth2User.rawUser : null;
  const roles = names(raw ? raw['roles'] : null);
  return {
    role: roles.indexOf(ADMIN_ROLE) !== -1 ? 'admin' : 'user',
    features: names(raw ? raw['permissions'] : null),
  };
};

/** Writes only on a difference, so that signing in is not by itself a reason
 *  to move `updated`. A json field reads back as its own text, which is what
 *  `getString` answers with, so `features` is compared against the
 *  serialization rather than against an array that is not there to compare. */
const apply = (app, record, identity) => {
  if (!record) return;
  const features = JSON.stringify(identity.features);
  if (
    record.getString('role') === identity.role &&
    record.getString('features') === features
  ) {
    return;
  }
  record.set('role', identity.role);
  record.set('features', identity.features);
  app.save(record);
};

module.exports = { fromClaims, apply };
