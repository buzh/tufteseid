/// <reference path="../pb_data/types.d.ts" />
//
// `attachments.file`: 20 MB → 50 MB.
//
// The starter set stopped arriving when Kartverket's 2025 reflights landed.
// A lokalitet is framed from the visible map, so its rectangle is routinely a
// kilometre and a half across; stitched at the density a 10 pkt project
// supports that is tens of megapixels, and Kartverket's own relief encodes to
// about a byte per pixel. One measured case: 1658 × 1585 m over "Rogaland
// 10pkt Vest 2025" is 66 Mpx and some 63 MB of PNG. PocketBase answered 400
// `validation_file_size_limit`, the pin queue marked all three starter images
// failed, and the retry button re-ran the same doomed upload. Nothing had
// changed in the app — the same rectangle over the older 5 pkt coverage was a
// quarter of the bytes.
//
// 50 MB is chosen against what the client will now hand over rather than as
// headroom for its own sake: `src/figure/figure.ts` fits every figure to
// 40 Mpx and re-encodes anything still over 50 MB, and records the resolution
// it actually wrote. So this is the ceiling that makes a full-native figure of
// an ordinary lokalitet — up to roughly 1.8 km square at 0.25 m/px — land
// whole, and the client's budget is what keeps a 3 km one from arriving here
// at 200 MB.
//
// Everything else about the field is restated exactly as 1700000500 left it:
// `fields.add()` with an existing id *replaces* the field, so an omitted
// property is a property removed.
//
// Written against the PocketBase v0.23+ JSVM API (App-based, flattened field
// classes). No ES2021 numeric separators — Goja / PB jsvm rejects them.

migrate(
  (app) => {
    const attachments = app.findCollectionByNameOrId('attachments');
    attachments.fields.add(
      new FileField({
        id: 'att_file',
        name: 'file',
        required: false,
        maxSelect: 1,
        maxSize: 50000000,
        mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        thumbs: ['200x200', '800x0'],
        protected: true,
      }),
    );
    app.save(attachments);
  },
  (app) => {
    const attachments = app.findCollectionByNameOrId('attachments');
    // Back to 20 MB. Files already stored above it stay where they are —
    // PocketBase validates uploads, not rows — so the down migration is only
    // a promise about what it will accept next.
    attachments.fields.add(
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
);
