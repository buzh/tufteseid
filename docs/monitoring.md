# Monitoring

| Question | Source | Read by |
| --- | --- | --- |
| Is anyone using it | Caddy access log on the host | `scripts/usage-report.sh` → GoAccess HTML |
| Are we being rude to the upstreams | wmscache access log in `docker compose logs` | `scripts/usage-report.sh` → printed digest |
| Is it healthy | both, plus `df`, plus `live-check.sh` | `scripts/health-check.sh`, from cron |

Both scripts are server-only and invoked by hand or cron, not daemons. GoAccess
runs as a throwaway container. There is no client-side analytics.

## First run

```sh
sudo mkdir -p /site/tufteseid/data/{logs,stats}
sudo chown "$USER" /site/tufteseid/data/stats
docker compose up -d             # picks up the bind mount
docker compose restart wmscache  # picks up the log_format
scripts/usage-report.sh
```

The restart is required and fails quietly: `nginx/wms-cache.conf` is
bind-mounted but nginx reads it only at startup, so the Upstreams section stays
empty (`(no lines — restart wmscache…)`) while everything else works.

## Client IPs

Every line carries two addresses and they are not the same question.
`request.remote_ip` is the last hop — the host's TLS terminator across the
Docker bridge, so a private `172.` address on every line is correct and says
nothing about the visitor. `request.client_ip` is the visitor, and it is the
only one anything reads: `usage-report.sh` and GoAccess's `CADDY` format both
take it.

`trusted_proxies static private_ranges` in the Caddyfile global block is what
makes Caddy derive `client_ip` from `X-Forwarded-For` at all. Safe only while
nothing but a private-address proxy reaches `:3000`, which is why
`docker-compose.yml` publishes it on `127.0.0.1`.

`trusted_proxies_strict` is the other half. Without it Caddy reads the header
left to right and takes the first untrusted address, which is whatever the
visitor typed: Cloudflare *appends* the connecting address rather than
replacing the header, so `X-Forwarded-For: 203.0.113.9` from a browser arrives
as `203.0.113.9, <real>` and the log records the spoof. Private spoofs are
skipped — `private_ranges` is trusted — so the symptom is a plausible public
address, not an obvious one. Strict reads right to left instead and stops at
the first untrusted hop, which is the address Cloudflare appended.

Strict assumes every hop between the visitor and Caddy is either trusted or
absent from the header. It holds because the terminator replaces
`X-Forwarded-For` with the single address Cloudflare reports rather than
appending to it; a terminator that appends would put a Cloudflare edge address
in the log instead. The header is kept in the access log so that stays
checkable.

```sh
grep -o '"client_ip":"[^"]*"' /site/tufteseid/data/logs/access.log \
  | sort | uniq -c | sort -rn | head
```

A `172.` address means `X-Forwarded-For` did not arrive, or carried nothing but
private hops, and those requests are all counted as one visitor; fix it in the
TLS terminator. A handful of them is ordinary — anything on the host that calls
`127.0.0.1:3030` direct.

## usage-report.sh

`scripts/usage-report.sh [report-dir]`

| Env | Default |
| --- | --- |
| `TUFTESEID_LOGS` | `/site/tufteseid/data/logs` |
| `TUFTESEID_STATS` | `/site/tufteseid/data/stats` (also the positional argument) |
| `HOURS` | `168` — printed sections only; the HTML covers every line Caddy still has |
| `GOACCESS_IMAGE` | `allinurl/goaccess:1.9.4` |

- **Visitors** — GoAccess over the Caddy log with `/wms/ /wfs/ /kms/ /arcgis/
  /cache/ /cvat/ /pb/` filtered out; `/assets/` kept so the bandwidth total is
  real. `--ignore-crawlers`, `--anonymize-ip` (/24). The printed line counts a
  page view as `/` or `/l/<code>`.
- **Traffic by prefix** — same log, unfiltered, by first path segment, plus the
  second for `/wms`, `/wfs` and `/arcgis` since that segment picks the upstream.
- **Upstream load** — needs the wmscache log; the cache verdict is recorded
  nowhere else. Everything but `HIT` and `UPDATING` asked the origin.
  **rate-limited** counts responses with content type
  `application/vnd.ogc.se_xml` — the "Overforbruk på kort tid" ServiceException
  `wms.geonorge.no` returns past its per-IP budget. It arrives as **HTTP 200**,
  so no status tally shows it, and `$skip_cache_type` keeps it out of the cache,
  so each one is a tile the visitor did not get. See
  `docs/wms-proxy-and-tiles.md`.
- **Where it lands** — the report directory is bind-mounted read-only into the
  `tufteseid` container and served at **`/stats/`**, which the account menu
  links to when `role = admin`. The link is the only thing the role gates:
  Caddy asks for no credentials, so the report is public to anyone who types
  the path. It carries an `X-Robots-Tag: noindex` and a CSP of its own, which
  has to allow `'unsafe-inline'` and `'unsafe-eval'`: GoAccess inlines its
  script and compiles its templates with `new Function`. Under the app's CSP
  the report stops at its loading screen reading "No authentication provided.",
  which is its own wording for a static report and not the failure. Gate it in
  the TLS terminator if public is not acceptable, or drop the mount and read
  `index.html` on the host.
- **Stores** — `du` over `cvat`, `mapproxy`, `logs` and the wmscache volume,
  with the delta since the last run (stamped in `<report-dir>/.sizes`). MapProxy
  fetches `wms.geonorge.no` directly, not through wmscache, and never evicts, so
  its store growth is the only measure of its outbound traffic. The wmscache
  volume evicts at 25 GB; a figure that stops climbing there is the LRU working.

## health-check.sh

```
*/30 * * * * /site/tufteseid/scripts/health-check.sh
```

`scripts/health-check.sh [base-url] [lokalitet-code]` — arguments are passed
through to `live-check.sh`. Silent on success. Run with `VERBOSE=1` by hand to
see every check.

| Env | Default | Checks |
| --- | --- | --- |
| `HOURS` | `1` | window for the log checks |
| `DISK_PCT` | `90` | filesystem holding `TUFTESEID_LOGS` |
| `MAX_5XX` | `50` | 5xx from Caddy in the window |
| `MAX_SHED` | `1` | rate-limited upstream responses |

Also checks that every compose service is running, that nginx has not logged
`no live upstreams`, and that `scripts/live-check.sh` exits 0.

`max_fails=0` on every peer in `nginx/wms-cache.conf` makes `no live upstreams`
impossible. If it appears, the container is not running the repo's config.

## Metrics

Caddy collects Prometheus metrics (`servers { metrics }`), served by the admin
endpoint. Nothing scrapes them. The endpoint is bound to `localhost:2019`
**inside** the container: the admin API rewrites the running config and has no
authentication, so it must stay off the compose network. Expose metrics with a
`metrics` handler on a second internal listener, not by reopening the admin
port.

```sh
docker compose exec tufteseid wget -qO- localhost:2019/metrics
```

## If GoAccess rejects the format

`--log-format=CADDY` is GoAccess's built-in spec for Caddy's JSON log. If a
version bump drifts it, substitute this for the `--log-format` line in
`scripts/usage-report.sh`:

```
--log-format='{"ts":"%x.%^","request":{"client_ip":"%h","proto":"%H","method":"%m","host":"%v","uri":"%U","headers":{"User-Agent":["%u"],"Referer":["%R"]}},"duration":"%T","size":"%b","status":"%s"}'
--date-format=%s
--time-format=%s
```

`%x.%^` reads the epoch and discards the fraction, which the `%s` parser rejects.

## Retention

| What | How long | Set where |
| --- | --- | --- |
| Caddy access log | 10 rolled generations of 20 MB, gzipped | `Caddyfile`, `log` block (`roll_size`, `roll_keep`) |
| wmscache access log | 4 × 50 MB | `docker-compose.yml`, `logging:` |
| mapproxy log | 3 × 20 MB | `docker-compose.yml`, `logging:` |
| rendersvc log | 3 × 20 MB | `docker-compose.yml`, `logging:` |
| GoAccess report | rebuilt from the whole log set every run | — |

How long `roll_keep` generations last is a function of line size, and a Caddy
JSON line is mostly headers. The `format filter` block drops `resp_headers`,
which is the same constant set on every line — the whole Content-Security-Policy
among them — and was 1.0 kB of a 2.3 kB line. Request headers are kept: they
are what `--ignore-crawlers` and the browser panel read, and they are where
`X-Forwarded-For` stays checkable. Caddy redacts `Cookie`, `Set-Cookie`,
`Authorization` and `Proxy-Authorization` to `REDACTED` by default, so no
credential reaches the log and `log_credentials` is left off.

Docker's json-file driver keeps every line forever unless capped, hence the
`logging:` blocks on the noisy services. rendersvc is capped for a different
reason: it writes a handful of lines per job, but each one is the trace of a
render nobody is watching, and the cap is what stops a stuck retry loop filling
the disk.

Longer history is `roll_keep`. For no request log at all, delete the `log`
block from the `Caddyfile` and the `/var/log/caddy` bind mount; both scripts
then report a missing access log and `health-check.sh` fails.
