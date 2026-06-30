# Kingdom 1516 — backend deployment & ops runbook

This directory stands up the **MVP-2 backend substrate**: Directus (headless CMS/API)
and Caddy (the single public edge), on one VPS via Docker Compose. It is the foundation
every later MVP-2 epic (auth, dynamic alliances, transfer pipeline, guides) builds on.

> **Scope:** infrastructure only. No auth wiring, no `src/lib/directus.ts`, no admin
> shell, no collections — those land in later Epic 3–6 stories. The public static site
> (`site/`) is unchanged; MVP-2 is purely additive (AR-3 / AD-1).

## What's here

| File | Role |
|---|---|
| `docker-compose.yml` | Two pinned non-root serving containers: Caddy + Directus (+ a one-shot `caddy-init`). |
| `Caddyfile` | TLS edge: serves the static site + reverse-proxies Directus on the admin subdomain. |
| `.env.example` | Template for the host-only `.env` (secrets + domains). Real `.env` is git-ignored. |
| `backup.sh` | Daily online SQLite snapshot + uploads tarball → rclone → Cloudflare R2. |
| `README.md` | This runbook. |

## The stack (AD-16 / AR-20)

```
                 :80 / :443                  internal compose network only
  Internet ───────────────▶  Caddy  ─────────────────────────▶  Directus (:8055)
                          (public edge)   reverse_proxy            (no published port)
                          static + proxy                          SQLite file DB
```

- **Caddy** is the *only* public surface. It serves the static Astro `dist/` (rsynced
  to `/srv/site` by CI) and reverse-proxies Directus on a dedicated admin subdomain.
- **Directus** has **no published port** — it is reachable only on the internal compose
  network (AR-5 / AD-3). It is never a user-facing surface. The DB is a SQLite file on a
  named volume, so there is no database port to expose.
- Pinned images: `directus/directus:12.0.2`, `caddy:2.11.4`. Both run **non-root**.
- Resource discipline: Directus `mem_limit: 512m`, Caddy `128m`; json-file logging capped
  `10m × 3`; `restart: unless-stopped`. Host carries **1–2 GB swap** (see provisioning).

### Non-root Caddy — the one gotcha (read before editing the compose)

Caddy must run non-root (AC1 / NFR-15). Two facts make that work, and one trap to avoid:

1. **Binding 80/443 as non-root:** the official Caddy binary carries the
   `cap_net_bind_service` file capability. With `user: "1000:1000"`, `cap_drop: [ALL]`
   and `cap_add: [NET_BIND_SERVICE]`, it binds privileged ports without root. *(Verified.)*
2. **Writable cert storage:** fresh `caddy_data` / `caddy_config` named volumes inherit
   the image's **root-owned** `/data` `/config` (0755), which the non-root Caddy **cannot
   write** — ACME certs + autosave would silently fail. The `caddy-init` one-shot service
   `chown`s the two volumes to `1000:1000` once, then exits. It is the only thing that
   runs as root, it runs for milliseconds, and it is idempotent (harmless on every `up`).

`docker compose ps -a` shows `caddy-init` as `Exited (0)` — that is success, not a crash.
Directus needs no such fix: its image already runs as `node` (uid 1000) and owns its data
dirs, so its named volumes are writable as-is.

## 1. Host provisioning

Use a **dedicated second** Vultr VPS, **isolated from the existing Discord-bot box**
(NFR-H / NFR-A) — do not co-host. Suggested size: 1 vCPU / 1 GB RAM / 25 GB.

```bash
# Docker + Compose plugin (Debian/Ubuntu)
curl -fsSL https://get.docker.com | sh

# Host tools the backup job needs
sudo apt-get update && sudo apt-get install -y sqlite3 rclone rsync

# 1–2 GB swap (AC2 — guards the 1 GB box under memory pressure)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab   # persist across reboot

# Static web root that CI rsyncs into and Caddy serves read-only
sudo mkdir -p /srv/site && sudo chown "$USER":"$USER" /srv/site
```

## 2. First run

```bash
# Copy this infra/ directory to the host, then:
cd infra
cp .env.example .env
# Edit .env: set a strong SECRET (`openssl rand -hex 32`), real ADMIN_EMAIL/PASSWORD,
# and the real domains once procured (see Domain below). NEVER commit .env.

docker compose up -d
docker compose ps -a          # caddy + directus = Up; caddy-init = Exited (0)
docker compose logs -f directus   # wait for "Server started at http://0.0.0.0:8055"
```

Open the admin subdomain in a browser, log in with the bootstrap admin, and:

1. **Change the admin password** in the Studio.
2. **Remove `ADMIN_PASSWORD`** from `infra/.env` (it is a first-run bootstrap only) and
   `docker compose up -d` to re-apply env. Keep `SECRET` stable — rotating it invalidates
   all existing sessions/tokens.

## 3. Backups → Cloudflare R2 (AC4 / NFR-16)

`backup.sh` runs **on the host** (it needs the live DB file) and pushes artifacts
**off-box** to R2. `sqlite3 .backup` is online-consistent — no Directus downtime.

```bash
# One-time: configure the rclone remote for R2 (S3-compatible). NEVER commit rclone.conf.
rclone config   # create a remote named `r2` (provider: Cloudflare R2, your access keys)
#   default destination is r2:kingdom1516-backups — override via RCLONE_REMOTE if different.

# Schedule daily (note: reading the named-volume mountpoint needs docker/root access)
sudo crontab -e
# 17 3 * * *  /srv/kingdom/infra/backup.sh >> /var/log/kingdom-backup.log 2>&1
```

Retention: ~14 daily + ~4 weekly (a weekly copy is kept on Sundays); older snapshots are
pruned automatically. The script `set -euo pipefail`s and exits non-zero on failure so the
cron mailer/log surfaces problems.

If the host lacks `sqlite3`, run the snapshot from a one-shot container instead:
`docker run --rm -v directus_db:/db nouchka/sqlite3 /db/data.db ".backup '/db/backup.db'"`,
then tar/push that file. (Prefer host `sqlite3` — it is simpler.)

### Restore

```bash
docker compose stop directus
# Pull the latest snapshot from R2:
rclone copy r2:kingdom1516-backups/daily/<YYYY-MM-DD>/ ./restore/
# Replace the DB + uploads in their named volumes (paths from `docker volume inspect`),
# then:
docker compose start directus
```

## 4. Publish-triggered rebuild (AC5 / AR-4)

A Directus publish/edit fires a webhook that triggers a GitHub `repository_dispatch`,
which rebuilds the static site and rsyncs it to `/srv/site` (CI → `.github/workflows/deploy.yml`).

**GitHub side (CI):** already wired. `deploy.yml` listens on
`repository_dispatch: [directus-publish]` and runs an SSH/rsync deploy gated by these repo
**secrets** (set them in GitHub → Settings → Secrets → Actions):
`SSH_HOST`, `SSH_USER`, `SSH_KEY` (private key for the deploy user), `DEPLOY_PATH` (`/srv/site`).
Until `SSH_HOST` is set the deploy step self-skips, so the build stays green pre-VPS.

**Directus side (per content collection):** add a **Flow** triggered on item create/update
(publish) that POSTs:

```
POST https://api.github.com/repos/<owner>/<repo>/dispatches
Authorization: Bearer <fine-grained PAT, contents:read+ or "Dispatch" scope>
Accept: application/vnd.github+json
Body: {"event_type":"directus-publish"}
```

No content collections exist yet (they land in Epic 4/6), so attach this Flow as those
collections are created. For now, **verify the pipe end-to-end with a manual dispatch**:

```bash
curl -X POST \
  -H "Authorization: Bearer <PAT>" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<owner>/<repo>/dispatches \
  -d '{"event_type":"directus-publish"}'
# → a "Build site" run should appear in GitHub Actions and rsync to the host.
```

No staging environment, by design (AR-4). Publish is live after a ~1–3 min rebuild.

## 5. Domain (Open Q1 — launch blocker, not a build blocker)

`SITE_DOMAIN`, `DIRECTUS_DOMAIN`, `CADDY_ACME_EMAIL` are **placeholders** with obviously-fake
defaults (`kingdom1516.example`). The stack builds, parses, and boots without a real domain;
Caddy auto-HTTPS goes live the moment a real domain's A/AAAA records point at the host.
Procuring the domain is the Owner's call (`.xyz`/`.com`, Cloudflare/Porkbun). Until then,
ACME cannot issue certs (expected off-VPS).

## 6. Operations

```bash
docker compose logs -f caddy        # or directus
docker compose pull && docker compose up -d   # update — but keep the PINNED tags; bump
                                              #   image versions deliberately in git, not via :latest
docker system prune -af              # weekly housekeeping (dangling images/containers)
```

## Local verification status (Story 3.1 / MIN-1)

Verified on the Windows/Docker dev box (`docker compose up`, real containers):

- `docker compose config` parses clean; **only Caddy publishes 80/443**; Directus has no
  published port (`8055/tcp` exposed, not host-mapped); no DB port anywhere.
- Directus boots, initializes its SQLite DB, and answers `/server/ping` (HTTP 200) **only**
  on the internal network — port 8055 is **closed** from the host.
- `caddy-init` chowns and exits 0; the non-root Caddy (uid 1000) then **binds 80/443** and
  **writes** `/data` + `/config` (cert store + autosave) — proving the ownership fix.
- Caddy loads the Caddyfile clean and reaches **`directus:8055` by service name** (`pong`).

Host-only (not runnable on the dev box — verified by parse/runbook, **not** live execution):
live auto-HTTPS (needs a real domain), the real `rclone`→R2 backup + prune (`rclone`/`sqlite3`
are not installed here; `backup.sh` passes `bash -n`), and the real Directus→GitHub webhook
(verify with the manual `curl` dispatch above).
