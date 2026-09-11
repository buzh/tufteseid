/// <reference path="../pb_data/types.d.ts" />
//
// Every schema change the lokalitet view needs, in one file.
//
// They land together on purpose. PocketBase records applied migrations by
// filename in `_migrations` and will never re-run one it has seen, so a
// field forgotten here cannot be added by editing this file later — and the
// symptom of a missing field is a silent 404 on the API call, not an error
// in the logs. The later build steps consume these one at a time; all of
// them exist from today. See docs/lokalitet-view.md §11.
//
// 1. `localities.code` — six characters of Crockford base32, unique and
//    required. The short code on the lokalitet row: the thing you read down
//    a phone or cite in a report to Riksantikvaren. Deliberately not derived
//    from the id, the name or the bbox, because it has to survive a rename
//    and a "Juster området". Generated client-side at create and retried on
//    the unique-index 400 (src/api/localities.ts) — no Go hook, nothing
//    added to the pinned image.
//
// 2. `attachments.sort` / `.hidden` — exhibit order and concealment (§4.4).
//    A working render stays in the lokalitet without being part of what the
//    lokalitet shows.
//
// 3. `attachments.file` → not required. The entire schema cost of the
//    View/File split (§4.1.2): an extract, terrain render or flyfoto is a
//    row of parameters that exists as a spec before a background queue pins
//    it to pixels, while a screenshot or an upload is only ever bytes. No
//    `spec` field and no `isView` field — `meta` already holds every
//    parameter, because the figure caption has to print the same set, and
//    the category is a function of `kind`.
//
// 4. `localities.derivedFrom` / `.derivedFromLabel` — a copy points at its
//    original with **cascadeDelete false**: deleting an original must not
//    delete the forks, which is the whole point of a fork. The label
//    denormalizes the original's name and owner at copy time, for the same
//    reason `finds.owner` is denormalized — attribution that vanishes when
//    the original does is not attribution.
//
// Written against the PocketBase v0.23+ JSVM API (App-based, flattened
// field classes). No ES2021 numeric separators — Goja / PB jsvm rejects
// them.

migrate(
  (app) => {
    const localities = app.findCollectionByNameOrId('localities');
    const attachments = app.findCollectionByNameOrId('attachments');

    // --- 1. localities.code, in three phases -------------------------
    // The order is load-bearing. A required field with a unique index
    // cannot be added to a table that already has rows: PocketBase gives
    // the new column SQLite's empty-string default, and the second
    // existing lokalitet then collides with the first. So the field goes
    // on optional, every existing row gets a code, and only then does it
    // become required and unique — all inside this one transaction, so a
    // half-applied state is not reachable.

    // Phase 1: the column, permissive.
    localities.fields.add(
      new TextField({
        id: 'loc_code',
        name: 'code',
        required: false,
        max: 6,
      }),
    );
    app.save(localities);

    // Phase 2: backfill.
    //
    // Crockford base32 — the digits and the consonants, minus I, L, O and
    // U, precisely so a code can be read aloud without spelling it.
    const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const newCode = () => {
      // $security is the JSVM's CSPRNG-backed string generator. Guarded
      // rather than assumed: this file gets exactly one chance to run, and
      // Math.random over 32^6 is entirely adequate for a backfill of a
      // handful of rows whose codes are read aloud, not presented as
      // secrets (the read rules, not the code, are what protect a private
      // lokalitet).
      if (
        typeof $security !== 'undefined' &&
        $security.randomStringWithAlphabet
      ) {
        return $security.randomStringWithAlphabet(6, ALPHABET);
      }
      let out = '';
      for (let i = 0; i < 6; i++) {
        out += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
      }
      return out;
    };

    // Written as raw UPDATEs rather than record saves so the backfill does
    // not touch `updated`. That column is the sort key for "Mine
    // lokaliteter", and a migration has no business reshuffling somebody's
    // list to the order the rows happen to come back in.
    const rows = app.findAllRecords('localities');
    const taken = {};
    for (let i = 0; i < rows.length; i++) {
      let code = newCode();
      while (taken[code]) code = newCode();
      taken[code] = true;
      app
        .db()
        .newQuery('UPDATE localities SET code = {:code} WHERE id = {:id}')
        .bind({ code: code, id: rows[i].id })
        .execute();
    }

    // Phase 3: tighten. `fields.add()` with an existing id replaces the
    // field, so this is a redefinition of just `code`.
    localities.fields.add(
      new TextField({
        id: 'loc_code',
        name: 'code',
        required: true,
        min: 6,
        max: 6,
      }),
    );

    // Plain unique index, no COLLATE — case-insensitive *matching* is the
    // client's job (codes are upper-cased on the way in and on the way to
    // a lookup), which keeps this off PB's index parser.
    const localityIndexes = [];
    for (let i = 0; i < localities.indexes.length; i++) {
      localityIndexes.push(localities.indexes[i]);
    }
    localityIndexes.push(
      'CREATE UNIQUE INDEX idx_localities_code ON localities (code)',
    );
    localities.indexes = localityIndexes;

    // --- 4. provenance of a copy -------------------------------------
    localities.fields.add(
      new RelationField({
        id: 'loc_derived_from',
        name: 'derivedFrom',
        required: false,
        collectionId: localities.id,
        // Not a typo and not an oversight: a fork outlives its original.
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 1,
      }),
      new TextField({
        id: 'loc_derived_from_label',
        name: 'derivedFromLabel',
        required: false,
        max: 400,
      }),
    );
    app.save(localities);

    // --- 2 & 3. attachments ------------------------------------------
    attachments.fields.add(
      new NumberField({
        id: 'att_sort',
        name: 'sort',
        required: false,
        onlyInt: true,
      }),
      new BoolField({
        id: 'att_hidden',
        name: 'hidden',
        required: false,
      }),
      // Same definition as 1700000200 in every respect but `required`.
      new FileField({
        id: 'att_file',
        name: 'file',
        required: false,
        maxSelect: 1,
        maxSize: 20000000,
        mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        thumbs: ['200x200', '800x0'],
        protected: true,
      }),
    );
    app.save(attachments);
  },
  (app) => {
    const localities = app.findCollectionByNameOrId('localities');
    const attachments = app.findCollectionByNameOrId('attachments');

    // Index first: PocketBase will not save a collection whose index
    // references a field that is no longer there.
    const localityIndexes = [];
    for (let i = 0; i < localities.indexes.length; i++) {
      const sql = localities.indexes[i];
      if (sql.indexOf('idx_localities_code') === -1) localityIndexes.push(sql);
    }
    localities.indexes = localityIndexes;
    localities.fields.removeById('loc_code');
    localities.fields.removeById('loc_derived_from');
    localities.fields.removeById('loc_derived_from_label');
    app.save(localities);

    attachments.fields.removeById('att_sort');
    attachments.fields.removeById('att_hidden');
    attachments.fields.add(
      new FileField({
        id: 'att_file',
        name: 'file',
        required: true,
        maxSelect: 1,
        maxSize: 20000000,
        mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        thumbs: ['200x200', '800x0'],
        protected: true,
      }),
    );
    app.save(attachments);
  },
);
