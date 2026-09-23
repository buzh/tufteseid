/// <reference path="../pb_data/types.d.ts" />
//
// `fields.add()` with an existing id replaces the field; an omitted
// property is a property removed.

migrate(
  (app) => {
    const localities = app.findCollectionByNameOrId('localities');
    const attachments = app.findCollectionByNameOrId('attachments');

    // A required unique field cannot be added to a populated table: existing
    // rows all get SQLite's empty-string default and collide. So the column
    // goes on optional, is backfilled, and is tightened last.
    localities.fields.add(
      new TextField({
        id: 'loc_code',
        name: 'code',
        required: false,
        max: 6,
      }),
    );
    app.save(localities);

    // Crockford base32: digits and consonants, minus I, L, O and U.
    const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const newCode = () => {
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

    // Raw UPDATEs rather than record saves, so the backfill leaves `updated`
    // alone — it is the sort key for the reader's own list.
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

    localities.fields.add(
      new TextField({
        id: 'loc_code',
        name: 'code',
        required: true,
        min: 6,
        max: 6,
      }),
    );

    // No COLLATE: the client upper-cases codes on the way in and on lookup.
    const localityIndexes = [];
    for (let i = 0; i < localities.indexes.length; i++) {
      localityIndexes.push(localities.indexes[i]);
    }
    localityIndexes.push(
      'CREATE UNIQUE INDEX idx_localities_code ON localities (code)',
    );
    localities.indexes = localityIndexes;

    localities.fields.add(
      new RelationField({
        id: 'loc_derived_from',
        name: 'derivedFrom',
        required: false,
        collectionId: localities.id,
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
    // references a field that is gone.
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
