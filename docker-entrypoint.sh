#!/bin/sh
# Writes the opt-in services (`ENABLE_*` in `.env`, passed through by
# docker-compose.yml) where the SPA can read them, then hands over to Caddy.
# The same keys decide which containers compose starts, via the `profiles:`
# interpolation beside each one — change one, break three.
set -e

# Exactly `true` is on, matching `profiles: ["enabled-${ENABLE_*}"]`: a value
# compose reads as off must read as off here too.
on() {
  if [ "$1" = "true" ]; then echo true; else echo false; fi
}

cat >/var/www/services.js <<EOF
window.__TUFTESEID_SERVICES__ = {
  flyfoto: $(on "${ENABLE_FLYFOTO:-}"),
  cvat: $(on "${ENABLE_CVAT:-}"),
  render: $(on "${ENABLE_RENDER:-}"),
  talk: $(on "${ENABLE_TALK:-}"),
};
EOF

exec "$@"
