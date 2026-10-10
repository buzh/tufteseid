/// <reference path="../pb_data/types.d.ts" />
//
// Sign-in is PocketBase's own, against an email and a password it holds
// itself. There is no identity provider any more (`docs/identity.md`).
//
// Versioned here rather than left to the admin UI, which is where the OAuth2
// client used to be set up and the one piece of the old arrangement that a
// `git pull` could not carry. Clearing `providers` is what actually removes
// the client: an OAuth2 config left enabled but unused still answers
// `listAuthMethods` and still accepts a code.
//
// `unmarshal` merges into the Go struct field by field, so anything not named
// here — `otp`, `mfa`, the verification templates — is left as it was.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    unmarshal(
      {
        passwordAuth: { enabled: true, identityFields: ['email'] },
        oauth2: { enabled: false, providers: [] },
        // Stock PocketBase already has this, and registration depends on it:
        // a guest POSTs their own row. What they may *put* on it is
        // `pb_hooks/identity.pb.js`' to say, and whether they may have one at
        // all is `pb_hooks/closed_beta.pb.js`'.
        createRule: '',
        // Empty is "any record of this collection may authenticate". Pinned
        // rather than assumed because a new account would otherwise be made
        // and then refused its own sign-in. `verified = true` here is how an
        // installation demands a confirmed address, at the cost of stranding
        // everybody who registered before the edit.
        authRule: '',
      },
      users,
    );

    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    // The provider itself cannot come back: its id and secret were only ever
    // in the admin UI, never here.
    unmarshal({ oauth2: { enabled: true } }, users);
    app.save(users);
  },
);
