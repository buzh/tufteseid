-- One-time repair for PocketBase databases created by the old
-- PocketBase 0.22 image (Tufteseid before the 0.40 bump).
--
-- Those databases gave the `localities` and `attachments` collections an
-- id identical to their name. PocketBase >= 0.23 forbids that, and its
-- own schema converter validates every collection as it runs, so the
-- upgrade aborts at boot with:
--
--   failed to apply migration 1717233556_v0.23_migrate.go: migrated
--   collection "localities" validation failure: name: The name must not
--   match an existing collection id.
--
-- The JS migrations in pb_migrations/ cannot fix this themselves:
-- PocketBase applies all of its built-in Go migrations before any JS
-- migration is registered, whatever the timestamps say. So the rewrite
-- has to happen out of band, against a stopped database.
--
-- Record tables are named after the collection *name*, so no row of user
-- data is touched -- only the collection ids and the `collectionId`
-- back-references inside the other collections' serialized schema.
--
-- Uploaded files, however, are stored under
-- storage/<collectionId>/<recordId>/, so `attachments` also needs its
-- storage directory moved. Run repair-pre-0.23-ids.sh rather than this
-- file on its own -- the script does both.
--
-- Safe to run twice. Against a database that is already on the new
-- schema the two id updates match nothing and the two schema rewrites
-- fail with "no such column: schema" -- noisy, but nothing is modified.
-- See the "Upgrading" section of README.md for how to run it against
-- the pbdata volume.

BEGIN;

UPDATE _collections SET id = 'pbc_localities'  WHERE id = 'localities';
UPDATE _collections SET id = 'pbc_attachments' WHERE id = 'attachments';

UPDATE _collections
   SET schema = replace(schema, '"collectionId":"localities"', '"collectionId":"pbc_localities"')
 WHERE schema LIKE '%"collectionId":"localities"%';

UPDATE _collections
   SET schema = replace(schema, '"collectionId":"attachments"', '"collectionId":"pbc_attachments"')
 WHERE schema LIKE '%"collectionId":"attachments"%';

COMMIT;
