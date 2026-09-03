#!/bin/sh
#
# One-time repair for PocketBase databases created by the old PocketBase
# 0.22 image (Tufteseid before the 0.40 bump). See the "Upgrading"
# section of README.md.
#
# Applies repair-pre-0.23-ids.sql to the pbdata volume and moves the
# attachment storage directory to match the new collection id, since
# PocketBase keys uploads by collection id:
# storage/<collectionId>/<recordId>/<filename>.
#
# Run it with the pocketbase service stopped:
#
#   docker compose stop pocketbase
#   ./pocketbase/repair-pre-0.23-ids.sh
#   docker compose up -d
#
# Takes the volume name as an optional argument (default
# tufteseid_pbdata). Safe to run twice.

set -eu

VOLUME="${1:-tufteseid_pbdata}"
SQL="$(cd "$(dirname "$0")" && pwd)/repair-pre-0.23-ids.sql"

docker run --rm \
  -v "$VOLUME:/pb_data" \
  -v "$SQL:/repair.sql:ro" \
  alpine:3.20 sh -eu -c '
apk add --no-cache sqlite >/dev/null

# The two schema rewrites in the script fail with "no such column:
# schema" on an already-upgraded database. That is the no-op case, so
# do not let it abort the run.
sqlite3 /pb_data/data.db < /repair.sql || true

if [ -d /pb_data/storage/attachments ]; then
  mv /pb_data/storage/attachments /pb_data/storage/pbc_attachments
  echo "moved storage/attachments -> storage/pbc_attachments"
fi

echo "collections after repair:"
sqlite3 /pb_data/data.db "SELECT id, name FROM _collections ORDER BY name"
'
