#!/bin/sh
set -e

on() {
  if [ "$1" = "true" ]; then echo true; else echo false; fi
}

cat >/var/www/services.js <<EOF
window.__TUFTESEID_SERVICES__ = {
  flyfoto: $(on "${ENABLE_FLYFOTO:-}"),
  cvat: $(on "${ENABLE_CVAT:-}"),
  render: $(on "${ENABLE_RENDER:-}"),
};
EOF

exec "$@"
