/// <reference path="../pb_data/types.d.ts" />
//
// Whose reading this is, said by the lokalitet itself.
//
// 1700000900 opened a public lokalitet to readers with no account but left
// `users` closed, which is the right call — a heritage note must not turn its
// author's account into a public directory entry. The cost is that
// `expand=owner` comes back empty for exactly the reader the share link exists
// for, so everything that names the author fell through to "Ukjent": the
// provenance plate on every image, the Rapportpakke front page, the *Delt av X*
// banner, the label a fork keeps of its original.
//
// `credit` is that name denormalized onto the record. Optional text, like
// `place` and for the same reason: it is the owner's to write, the account's
// display name is only its starting value, and a lokalitet published under a
// pseudonym or a field unit's name is a legitimate thing to want. Empty means
// the record declines to say, and the surfaces fall back to `expand.owner`
// where they can read it and to "Ukjent" where they cannot.
//
// It rides the record's own read rule, so it is published exactly when the
// lokalitet is. Nothing about `users` changes here.
//
// Written against the PocketBase v0.23+ JSVM API (App-based, flattened field
// classes).

migrate(
  (app) => {
    const localities = app.findCollectionByNameOrId('localities');
    localities.fields.add(
      new TextField({
        id: 'loc_credit',
        name: 'credit',
        required: false,
        max: 200,
      }),
    );
    app.save(localities);
  },
  (app) => {
    const localities = app.findCollectionByNameOrId('localities');
    localities.fields.removeById('loc_credit');
    app.save(localities);
  },
);
