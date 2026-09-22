# Monitoring

Three questions, and no single log answers more than one of them:

| Question | Source | Read by |
| --- | --- | --- |
| Is anyone using it | Caddy's access log, on the host | `scripts/usage-report.sh` → GoAccess HTML |
| Are we being rude to the upstreams | wmscache's access log, in `docker compose logs` | `scripts/usage-report.sh` → printed digest |
| Is it healthy | both of the above, plus `df`, plus `live-check.sh` | `scripts/health-check.sh`, from cron |

Nothing runs continuously and nothing is added to the compose stack. Both
scripts are things you invoke: one you read, one that mails you. GoAccess
arrives as a throwaway container and leaves nothing behind but an HTML file.

There is no client-side analytics and there is not going to be. The app ships
no tracker, `script-src` is `'self'`, and every number below is derived from
logs the server already had to write.

## Turning it on

The Caddy log is a host path, like the cVAT and MapProxy stores, because
something outside the stack reads it:

```sh
sudo mkdir -p /site/tufteseid/data/logs /site/tufteseid/data/stats
docker compose up -d           # picks up the bind mount
docker compose restart wmscache  # picks up the log_format
```

The restart is not optional and forgetting it is quiet: `nginx/wms-cache.conf`
is bind-mounted but nginx reads it only at startup, so the Upstreams section of
the report stays empty while everything else works.

Then:

```sh
scripts/usage-report.sh
```

## Client IPs

Caddy is not the edge. The host's TLS terminator reaches it over the Docker
bridge, so without help every request would log the bridge's address and the
report would show one visitor forever. `trusted_proxies static private_ranges`
in the Caddyfile's global block tells Caddy to believe the `X-Forwarded-For`
that terminator sets, and it is what fills the log's `client_ip` field — the
field GoAccess counts.

That is a claim about the deployment, not about Caddy. It holds only while
nothing reaches `:3000` except a proxy on a private address, which is why
`docker-compose.yml` publishes the port on `127.0.0.1` and why widening that
would turn a trusted header into a spoofable one.

To check that the terminator actually sends the header, look at one line:

```sh
tail -1 /site/tufteseid/data/logs/access.log | grep -o '"client_ip":"[^"]*"'
```

A public address means it works. A `172.` address means the header is not
arriving and every visitor is being counted as one — fix it in the terminator,
not here.

## What the report says

**Visitors** is GoAccess over the Caddy log with the proxy prefixes stripped
out. That filter is the difference between a useful report and a list of tile
endpoints: one pan of the map is a screenful of `/wms/` and `/cache/`, so
without it "top pages" is noise and the visitor count is a request count.
`/assets/` stays in, because GoAccess sorts static requests into their own
panel and dropping them would make the bandwidth total a fiction.

Crawlers are filtered (`--ignore-crawlers`) and addresses are truncated to a
/24 (`--anonymize-ip`). The first matters because against a handful of real
visitors a week an unfiltered count is mostly scanners; the second costs the
ability to tell two visitors on one /24 apart, and buys a report that can be
left lying around.

The HTML covers every line Caddy still has. The printed sections respect
`HOURS` (default 168).

**Traffic by prefix** is the same log, unfiltered, grouped by the first path
segment — and by the second where the second one picks an upstream rather than
naming a file, so `/wms/ra` and `/wms/geonorge` stay apart. This is the section
that shows how little of the traffic is pages.

**Upstream load** is the only one that needs wmscache's own log, because the
cache verdict is recorded nowhere else. `$upstream_cache_status` is `HIT` /
`MISS` / `EXPIRED` / `STALE` / `REVALIDATED` / `BYPASS`, or `-` on the one
uncached location. Everything but `HIT` and `UPDATING` means the origin was
asked — that count, per host, is the answer to whether we are being rude.

Two columns need naming. **5xx** is what it looks like. **rate-limited** counts
responses whose content type is `application/vnd.ogc.se_xml`: the 238-byte
"Overforbruk på kort tid" ServiceException that `wms.geonorge.no` answers with
once we pass its per-IP budget. It arrives as a **200**, so it is invisible in
any status-code tally, and `$skip_cache_type` keeps it out of the cache — which
means every one of them is a tile a visitor did not get. See
`docs/wms-proxy-and-tiles.md`.

**Stores** is `du`, with the delta since the last run. That delta is doing real
work: MapProxy fetches from `wms.geonorge.no` **directly**, not through
wmscache, so its outbound traffic appears in no log this project keeps. But
MapProxy never evicts, so bytes added to its store since the last run are bytes
fetched since the last run. The wmscache volume evicts at 25 GB and so
plateaus instead of growing; a number that stops climbing there is the LRU
working, not the cache dying.

## The health check

```
*/30 * * * * /site/tufteseid/scripts/health-check.sh
```

Silent on success, so cron mails you the problems and nothing else. Run it by
hand with `VERBOSE=1` the first time to see what it is actually checking.

It asks six things in the order that a failure in one explains the next: are
the containers up, is the disk filling, is Caddy answering 5xx, is an upstream
shedding us, has nginx lost every peer in a group, and does the app still work
end to end. The last is `scripts/live-check.sh` run whole rather than
reimplemented — it already asks one question per service and its exit status is
the verdict.

Thresholds are environment variables (`DISK_PCT`, `MAX_5XX`, `MAX_SHED`,
`HOURS`) and none of them marks something broken; they mark the point past
which somebody should look. `MAX_SHED` defaults to 1 because a single
rate-limited response is already a dropped tile.

"no live upstreams" is in the list for a specific reason: `max_fails=0` on every
peer in `nginx/wms-cache.conf` exists to make that message impossible. If it
appears, the config running in the container is not the one in the repo.

## Metrics

`servers { metrics }` is on, so Caddy is collecting Prometheus metrics —
request counts, durations and statuses per handler — whether or not anything
reads them. They are served by the admin endpoint, which is bound to
`localhost:2019` **inside** the container:

```sh
docker compose exec tufteseid wget -qO- localhost:2019/metrics
```

Loopback rather than the container's network address, because the admin API
rewrites Caddy's running config, has no authentication of its own, and would
otherwise be reachable from every other service on the compose network. The
metrics endpoint riding on the same listener is the reason that matters.

Nothing scrapes this, on purpose. A time-series database answers "when did this
change", and the digests above answer "what is it now" — which is the question
a one-person site actually has. When that stops being true, the change is a
`metrics` handler on a second internal listener plus one compose service; do
not reach for it by opening the admin port again.

## If GoAccess rejects the format

`--log-format=CADDY` is GoAccess's built-in spec for Caddy's JSON access log.
If a version bump drifts it out of step with what Caddy writes, the same thing
can be said explicitly — substitute this for the `--log-format` line in
`scripts/usage-report.sh`:

```
--log-format='{"ts":"%x.%^","request":{"client_ip":"%h","proto":"%H","method":"%m","host":"%v","uri":"%U","headers":{"User-Agent":["%u"],"Referer":["%R"]}},"duration":"%T","size":"%b","status":"%s"}'
--date-format=%s
--time-format=%s
```

`%x.%^` reads the epoch and discards the fractional part, which the `%s` date
parser will not take.

The image is pinned in the script and overridable with `GOACCESS_IMAGE`.

## Retention

| What | How long | Set where |
| --- | --- | --- |
| Caddy access log | 10 rolled generations of 20 MB, gzipped | `Caddyfile`, the `log` block |
| wmscache access log | 4 × 50 MB | `docker-compose.yml`, `logging:` |
| mapproxy log | 3 × 20 MB | `docker-compose.yml`, `logging:` |
| GoAccess report | rebuilt from the whole log set every run | — |

The report holds no state of its own, which is the point: running it twice in
an hour counts nothing twice, and there is no database to corrupt or migrate.
Longer history is `roll_keep`, nothing else. Docker's json-file driver keeps
every line forever unless capped, which is what those `logging:` blocks are
for — before them, the two noisiest services grew without bound.
