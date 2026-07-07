# Kingdom 1516 — backend deployment & ops runbook

This directory stands up the **MVP-2 backend substrate**: Directus (headless CMS/API)
and Caddy (the single public edge), on one VPS via Docker Compose. It is the foundation
every later MVP-2 epic (auth, dynamic alliances, transfer pipeline, guides) builds on.

> **Scope:** infrastructure + the backend half of **leader auth** + the **role model**
> (Story 3.3 — the authorization contract in `roles-and-policies.md`, applied per §7). Story
> 3.2 adds the cross-subdomain CORS + httpOnly session-cookie config to the Directus service
> (see **Auth model** below); the login UI + `site/src/lib/directus.ts` live in `site/`. Still
> to come: the admin shell (3.5) and the domain collections (Epic 4–6) — the per-collection
> permission **grants** attach to the 3.3 policies as those collections land. Public pages are
> unchanged and render with Directus offline; MVP-2 is purely additive (AR-3 / AD-1).

## What's here

| File | Role |
|---|---|
| `docker-compose.yml` | Two pinned non-root serving containers: Caddy + Directus (+ a one-shot `caddy-init`). |
| `Caddyfile` | TLS edge: serves the static site + reverse-proxies Directus on the admin subdomain. |
| `.env.example` | Template for the host-only `.env` (secrets + domains). Real `.env` is git-ignored. |
| `backup.sh` | Daily online SQLite snapshot + uploads tarball → rclone → Cloudflare R2. |
| `roles-and-policies.md` | Canonical role/policy/permission spec — the authorization contract (Story 3.3). Applied in the Data Studio per §7. |
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

## Auth model — leader login (Story 3.2)

Leaders sign in at the static site's **`/leader`** page. The flow is **client-side** — the
site is `output: 'static'` (Caddy only serves files; there is no Astro server runtime):

1. The browser (on `/leader`) calls Directus directly on the **admin subdomain** via the
   `@directus/sdk` in **session-cookie mode** (`login({ mode: 'session' })`).
2. Directus responds by setting an **httpOnly `directus_session_token` cookie**. The token
   is **never** exposed to JavaScript and **never** written to `localStorage` — the XSS
   defense required by AR-18 / NFR-D.
3. On later requests the browser attaches that cookie automatically (`credentials: 'include'`),
   so `getCurrentUser()` and any admin read is authenticated; an unauthenticated call gets a
   server-enforced **401** (AD-4). Admin data is never baked into the static HTML.

**Why the cross-subdomain config exists.** The site (apex `$SITE_DOMAIN`) and Directus
(`$DIRECTUS_DOMAIN`) are **different origins** but the **same site** (shared registrable
domain). The login fetch is cross-origin, so the Directus service carries this config — all
derived from `SITE_DOMAIN`, **non-secret**, set directly in `docker-compose.yml`:

| Env | Value | Why |
|---|---|---|
| `CORS_ENABLED` / `CORS_ORIGIN` | `true` / `https://$SITE_DOMAIN` | allow the apex origin (never `*` with credentials) |
| `CORS_CREDENTIALS` | `true` | sends `Access-Control-Allow-Credentials`; without it the browser drops the cookie |
| `SESSION_COOKIE_SECURE` | `true` | HTTPS-only cookie |
| `SESSION_COOKIE_SAME_SITE` | `lax` | apex + subdomain are same-site → `lax` suffices and is stronger than `None` |
| `SESSION_COOKIE_DOMAIN` | `.$SITE_DOMAIN` | parent-domain cookie shared across apex + subdomain |

The frontend seam is `site/.env` → **`PUBLIC_DIRECTUS_URL`** (the `https://` admin subdomain).
It **must equal** the live `DIRECTUS_DOMAIN` — a mismatch breaks CORS and login.

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
3. **Verify the first leader login end-to-end** (the Story 3.2 AC1–AC4 smoke test). On the
   live HTTPS host, open the site's **`/leader`** page and log in with the admin credentials:
   - the **`directus_session_token`** cookie is present and flagged **`HttpOnly`** +
     **`Secure`** (DevTools → Application → Cookies);
   - **`localStorage` and `sessionStorage` are empty** — no token is in JS;
   - the page swaps to "Signed in as …"; **Log out** clears the cookie and returns the form.

   `PUBLIC_DIRECTUS_URL` in the site build env **must equal** this host's `DIRECTUS_DOMAIN`,
   or the browser blocks the cross-origin login.

4. **Apply the role model, then run the first-login role smoke test** (Story 3.3 — do this
   after §7 has been applied). With a **non-Owner test leader** account (create one in the
   Studio, assign it a single read-only policy):
   - authenticate as that leader and confirm they can `GET` **only** what their policy allows;
   - a raw API **write above their role** — e.g. `POST`/`PATCH`/`DELETE` to `directus_users`,
     `directus_roles`, or `directus_policies` — returns **403** (deny-by-default; the
     privilege-escalation guard). *(Proven locally, Story 3.3 — see the verification trailer.)*
   - `GET /permissions/me` as the leader shows **exactly** their policy set (the read the 3.5
     shell will use for the role chip + absent tabs);
   - the **Owner** (Administrator) overrides the same write (→ 200).
   - **Unauthenticated** `GET /users` / `/roles` / `/policies` → **403** (Public is locked).

   > ⚠️ **Row/field-scoped rules need a Directus license — Owner chose Option 3 (see
   > `roles-and-policies.md` §0).** The own-row (`official = $CURRENT_USER`) and
   > publish-field-gate boundaries are *custom permission rules*, which Directus 12 restricts to
   > a **licensed** tier (Core tier → `403 RESOURCE_RESTRICTED` at creation). **Decision
   > (2026-07-01): collection-level enforcement only** — those two boundaries are UX-guided in
   > the Story 3.5 shell, **not** server-enforced. The collection boundary above (Viewer can't
   > write, Owner overrides, Public locked) is free, proven, and the real server riegel.
   >
   > **Scope of this test:** it exercises only the *collection* boundary. It **cannot** detect a
   > leaked Option-3 UX-only boundary — an Editor publishing, an Official editing another row, a
   > Curator writing a non-work field — because those have **no** server check; verify the
   > Transfer/Guides ones by inspecting the Story 3.5 shell UI, and the **Alliances** one (an Official
   > editing another row, or writing `official`/`slug`) via **Data-Studio Owner discipline** — alliances
   > are Data-Studio-only, **not** in the 3.5 shell (`roles-and-policies.md` §4 mechanism 1; §9.4). A
   > green smoke test is **not** full-model verification.

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

## 7. Roles, policies & permissions (Story 3.3)

The **what** — the canonical role/policy/permission contract — is
[`roles-and-policies.md`](roles-and-policies.md). This section is the **how-to-apply**: a
one-time, first-run Owner task in the Directus Data Studio (**Settings → Access Policies**).
Roles/policies live only in `data.db`; there is no import script (AD-3 / YAGNI) — you author
them once, and the daily backup (§3) preserves them.

> ⚠️ **Licensing gate — Owner chose Option 3 (read `roles-and-policies.md` §0).** Directus 12
> restricts **custom permission rules** (row/item filters, field-level subsets, validation,
> presets) to a **licensed** tier; the unlicensed **Core** tier rejects them with
> `403 RESOURCE_RESTRICTED`. **Decision (2026-07-01): accept collection-level enforcement** —
> the **Alliance Official own-row** (AD-5) and **Guides publish field-gate** (AD-6) become
> **UX-guided in the Story 3.5 shell, not server-enforced**. Everything below at **collection
> granularity** is the real server riegel and works on Core tier. (Licensing later → the 🔒
> rules flip back on with no spec change.)

**Order to apply (first run):**

1. **Owner = Administrator.** The bootstrap admin (you) already maps to the built-in
   **Administrator** role (`admin_access: true`) — the universal override. **Do not** add
   per-collection Owner allow-rules; the admin bypass *is* the override.
2. **Confirm Public is locked.** The built-in **Public** policy must have **no** permissions
   (the secure baseline). Epic 5.2 later adds the single **create-only** `candidates` grant —
   nothing before then.
3. **Create the base `Leader` role** — the container every leader shares (login +
   read-own-profile only).
4. **Create the six per-area policies** named in `roles-and-policies.md` §2 —
   `transfer-viewer`, `transfer-curator`, `guides-viewer`, `guides-editor`, `guides-senior`,
   `alliances-official`. Their **collection-level** grants are free; their **row/field** rules
   are 🔒 licensed (attach per §3 as each collection lands in Epics 4–6). *(The `alliances-official`
   read + update grants are now wired — see §9.4, Story 4.2.)*
5. **Leaders receive a *combination* of per-area policies**, attached to their account **on top
   of** the base `Leader` role — **not** a new monolithic role. Example: a leader who is
   *Viewer in Transfer* **and** *Editor in Guides* gets **two** policies
   (`transfer-viewer` + `guides-editor`); Directus unions them. A **Curator** gets
   `transfer-curator` **instead of** `transfer-viewer` (curator already includes read — don't
   stack both).
6. **`app_access`:** set `true` on policies whose holders use the Data Studio
   (Editor / Senior / Official / Owner). The Candidates-shell-only Transfer roles *may* be
   API-only — confirm when the shell + collections exist (Epic 5). API login itself does **not**
   need `app_access`.

**Curator ≤ 2 (anti-bias) — an Owner discipline, not a check.** Attach `transfer-curator` to
**at most two** accounts. Directus has no "max N per policy" constraint, and building a counter
would be over-engineering (KISS/YAGNI). ~8 read-only Viewers + ≤2 Curators = anti-bias +
transparency-by-design. The *permission boundary* (Curator writes, Viewer 403s) **is**
server-enforced; the *headcount* is your discipline here.

Then run the **first-login role smoke test** in §2 (item 4) to confirm the boundary, the Owner
override, `/permissions/me`, and the Public lock.

## 8. Leader accounts — create, assign roles, reset, offboard (Story 3.4)

§7 is the **policy** apply-runbook (author the six per-area policies once). This section is the
**user-account lifecycle** that consumes them: how the **Owner** creates each leader's account
and attaches the §7 policy *combination*, day to day, in the Data Studio. **All of it is
Owner-only and happens in the Data Studio — there is no custom account-management screen** (AC2 /
AD-3 / AR-5 / NFR-18). The **only** custom admin surface in the whole product is the Candidates
pipeline (Story 3.5); Accounts, Roles, Guides authoring, and Alliances CRUD all use the Studio
directly. For the *policy* names and what each grants, see §7 and `roles-and-policies.md` §2 —
**not** repeated here.

> **Why the Owner and only the Owner.** Writing `directus_users` / `directus_roles` /
> `directus_policies` is the **AD-9 `users / roles / policies → Owner`** field-group: a non-Owner
> leader gets a server-enforced **403** on creating an account or changing anyone's role/policies
> (the privilege-escalation guard, AC1 / NFR-9), and the Owner writes via the built-in
> **Administrator** (`admin_access`) bypass. This is base RBAC — free on the Core tier, no custom
> permission rule, no license (proven, see the verification trailer).

### 8.1 Create a leader account (AC1)

Data Studio → **User Directory** (the people icon in the module bar; on some 12.x builds also
reachable via **Settings**) → **Create User**. Then either:

- **Set an initial password** — enter `email` + `password`, or
- **Invite** — enter `email` only and use **Invite**; the user is created with status
  **`invited`** and stays inactive until they click the emailed link and set their **own**
  password. ⚠ **Invite needs email/SMTP, which is NOT configured on the current stack**
  (`docker-compose.yml` sets no `EMAIL_*`): no invite mail is sent and the `invited` account can
  never activate — use **Set an initial password** until a host SMTP is configured.

Assign the base **`Leader`** role (the shared container from §7 step 3). API-equivalents (both
Owner-only): `POST /users {email, password, role}` or `POST /users/invite {email, role}` — `role`
is the role **id**.

### 8.2 Assign the per-area role combination (AC3)

On the user, attach the §7 per-area **policies** as a *combination* on top of the base `Leader`
role — Directus grants the **union** of every policy held, and areas apply **independently**.
Worked example (the AC3 case): a leader who is **Viewer in Transfer *and* Editor in Guides** gets
**two** policies — **`transfer-viewer` + `guides-editor`**. Add `guides-viewer` for a
Guides-reader, `alliances-official` for an alliance owner, and so on; each area is a separate
policy.

> **Curator ≠ stack both.** A Transfer **Curator** gets **`transfer-curator` *instead of***
> `transfer-viewer` (curator already includes read). Don't attach both. (Same rule as §7 step 5.)

### 8.3 Change a leader's roles later (AC3)

Add or remove a policy on the account; the union **recomputes** on the next request and areas
stay **independent** — e.g. promoting a Guides Editor to Senior is *swap `guides-editor` →
`guides-senior`*, and it leaves their Transfer access untouched. No account is ever rebuilt; you
only edit the attached policy set.

### 8.4 Owner-driven password reset (resolves the Story 3.2 deferral)

Two Owner-driven paths, **no custom screen** (AD-3):

- **In the Studio** — open the user and set a new `password` directly; or
- **Built-in email flow** — trigger Directus's `POST /auth/password/request {email}`, which sends
  the user a reset link. ⚠ This needs email/SMTP configured, which the current stack does **not**
  have (`docker-compose.yml` sets no `EMAIL_*`); worse, the endpoint returns **2xx even when no
  mail is sent**, so it fails *silently*. Until a host SMTP is configured, use the **Studio
  set-password** path above (the reliable Owner-driven reset).

A **leader-facing "forgot password" UX is explicitly out of scope** — password administration is
Owner-driven, consistent with the headless-only posture. (This closes the 3.2 "password reset =
Owner-via-Data-Studio, Story 3.4" deferral.)

### 8.5 Offboard a leader

Prefer **revoke-but-keep** over delete, for the audit trail:

- **`status: suspended`** — the account can no longer authenticate but the record (and its
  authorship of past edits) survives. The default offboard.
- **`status: archived`** — same auth block, filed away.
- **`delete`** — only when the record is genuinely unneeded. Avoid mid-transfer-window: deleting
  an account that authored candidate/group edits loses that trail. **If the account is an Alliance
  Official** (Story 4.1), deleting it nulls that alliance's `official` M2O pointer (`ON DELETE SET
  NULL`) — the alliance row survives but is left **without an Official until reassigned** (§9.3), so
  prefer `suspended`, or reassign the Official first.

API: `PATCH /users/:id {status: "suspended"}` (or `"archived"`). Suspended/archived users cannot
log in — **Directus built-in** status behavior (not exercised by the 3.4 proof, which covered
account create + role/policy change; see the verification trailer's honest-limits note).

### 8.6 Administrative disciplines (Owner governance, NOT runtime checks)

These are **governance rules the Owner follows**, not constraints Directus enforces — do **not**
build a counter or cardinality check for either (KISS/YAGNI; see §7 and `roles-and-policies.md`
§5):

- **Curator ≤ 2 (anti-bias)** — attach `transfer-curator` to **at most two** accounts. The
  *permission boundary* (Curator writes, Viewer 403s) is server-enforced; the *headcount* is your
  discipline.
- **One Alliance Official per alliance** — under the ratified **Option 3**, `alliances-official`
  is a **full-collection** `alliances` update grant (the `official = $CURRENT_USER` own-row filter
  is the 🔒 licensed Option-1 upgrade target, not wired now), so "one Official per alliance" and
  own-row editing are **Owner discipline**, not a 403. The Official edits their alliance in the
  **Data Studio** (per the §8 preamble — Alliances are not part of the Candidates admin shell,
  AD-3). Attach the policy to one account per alliance.

### 8.7 `app_access` — who needs the Data Studio

A leader whose work happens **in the Data Studio** (Guides **Editor** / **Senior**, Alliance
**Official**, the **Owner**) needs **`app_access: true`** on a policy they hold. The
Candidates-shell-only Transfer roles (**Viewer** / **Curator**) **may** be API-only *without*
`app_access` — they use the custom admin shell (Story 3.5), not the Studio; **host-confirm** the
exact implication when that shell + the domain collections exist (Epic 5). Plain **API login does
NOT require `app_access`** (verified in Story 3.3 — a test leader with `app_access: false`
authenticated and hit the API).

## 9. Alliances collection (Story 4.1)

The `alliances` collection is the canonical, dynamically-maintainable home for the alliance
dataset (AD-18) — created here and seeded from the MVP-1 static mirror
(`site/src/data/alliances.json`). **CRUD is Data-Studio-only — no custom UI** (AD-3 / AR-5 /
NFR-18). The public Finder still reads the static file; the build-time swap to Directus is
**Story 4.3**, not this story.

**Reproducibility:** the data model is version-controlled in **`infra/directus-schema.yaml`** (a
`directus schema snapshot` — collections, fields, and relations, plus a `systemFields` block of
Directus's own system-field index state; **not** permissions or rows). Rebuild the empty collection
on a fresh box:

```bash
docker compose cp ./directus-schema.yaml directus:/tmp/schema.yaml
docker compose exec directus npx directus schema apply --yes /tmp/schema.yaml
```

`schema apply` is **version-gated**: the snapshot is pinned to `directus: 12.0.2` (matching the
compose image). **After any Directus image bump (§6), regenerate the snapshot** (`schema snapshot`)
and commit it — otherwise `schema apply` aborts on the version mismatch. On the same version the
`systemFields` block is a no-op; on a divergent instance `--yes` would apply those system-index
changes non-interactively, so re-snapshot rather than apply across versions.

Grants are wired in Story 4.2 (the `alliances-official` read + update grant — see §9.4); the seed rows
are re-entered per §9.2 or restored from the daily `data.db` backup (§3).

### 9.1 Field spec (canonical AD-18 shape)

| Field | Directus type | Null | Notes |
|---|---|---|---|
| `id` | integer (auto PK) | no | internal only; public addressing is by `slug`, never the id (AR-18) |
| `name` | string | no | display name / in-game tag |
| `slug` | string, **unique** | no | immutable kebab-case public address; set once at creation. Server-enforced immutability is a 🔒 licensed validation rule (§0, `roles-and-policies.md`) — so it is Owner discipline + an optional readonly interface, not a rule |
| `bear_trap_1` | **`time`** | yes | UTC time-of-day `HH:MM` (AR-12 / AD-10) |
| `bear_trap_2` | **`time`** | yes | UTC time-of-day — two **independent** scalars ("two, OR"; attending one suffices) |
| `peak` | **`time`** | yes | UTC time-of-day; a single scalar, **never a range** |
| `farm_alliance` | string | yes | optional in-game farm-alliance tag; **case preserved verbatim** (not a boolean, not an FK) |
| `official` | **M2O → `directus_users`** | yes | the alliance's leader account; **`ON DELETE SET NULL`**; the Owner assigns it (FR-3) |

`bear_trap_*` / `peak` are `time` (not `datetime`) — the values are recurring daily event
times-of-day with **no date**. SQLite stores `HH:MM` verbatim (`00:30` stays `00:30`).

### 9.2 Seed from the static mirror

Import the **six scalar fields** of each of the 5 rows in `site/src/data/alliances.json` verbatim —
via the Data Studio import (**import as JSON — the file is a bare JSON array; a CSV import
numeric-coerces the digits-only `516` name/slug**) or a `POST /items/alliances`. **Omit `official`**
(the file holds leader *name strings*, which cannot go into the `directus_users` M2O). Preserve the
`farm_alliance` casing and the digits-only `516` **slug as a string** (no numeric coercion).

### 9.3 Assign each alliance's Official (FR-3)

After seeding, the Owner sets each row's `official` to the matching leader's **Directus user** in the
Data Studio — using the `official` name in `alliances.json` as the name→user map. The Official's
account must exist first (create it per §8.1). Under **Option 3**, an Official holds a
full-collection `alliances` update grant (**wired in Story 4.2 — see §9.4**); own-row editing is Owner
discipline in the Data Studio, not a server-side filter (§0; `roles-and-policies.md` §4). Deleting an Official's account
nulls the `official` pointer (the `SET NULL` above), leaving the alliance without an Official until
reassigned — see §8.5.

### 9.4 Alliance Official editing (Story 4.2)

Wire the `alliances-official` policy so an Alliance Official can maintain **their own** alliance in the
Data Studio. This is the read + update grant on the `alliances` collection (created in §9.1); it
attaches to the **same** `alliances-official` policy authored in §7 step 4, **in combination on the
base `Leader` role** (union — §7 step 5). **The grant lives only in `data.db`** (the daily backup, §3);
it is **not** in `directus-schema.yaml` — a `schema snapshot` captures collections/fields/relations
only, never permissions (`roles-and-policies.md` §6). So there is no git artifact for the grant itself;
this runbook + `roles-and-policies.md` §3 are the source of truth.

**Prerequisite:** the Official's user account exists (§8.1) and holds the `alliances-official` policy
(§7 step 5); the Owner has also assigned it as that alliance's `official` (§9.3).

> **Edit access comes from *holding the policy*, not from the `official` assignment.** The grant is
> full-collection (no row filter), so the `official` M2O records *intent* (whose row it is) but does
> **not** gate who can edit. To **revoke** an Official's edit access, **detach the `alliances-official`
> policy** — nulling or reassigning the `official` pointer (§8.5 / §9.3) does **not** remove edit rights.

**Grant shapes** — Data Studio → **Settings → Access Policies → `alliances-official` → Permissions**,
on the `alliances` collection:

| Action | Fields | Filter (`permissions`) | Note |
|---|---|---|---|
| **read** | `["*"]` | none | ✅ free |
| **update** | `["*"]` | none (`permissions: {}`) | ✅ free — **the only free update shape** |

- **Do NOT** author the field subset `["name","bear_trap_1","bear_trap_2","peak","farm_alliance"]` and
  **do NOT** author the row filter `{ "official": { "_eq": "$CURRENT_USER" } }`. On the Core tier **each
  is a 🔒 custom permission rule → `403 RESOURCE_RESTRICTED`** (re-verified in the 4.2 proof below); they
  are the Option-1 upgrade target only (`roles-and-policies.md` §0/§3).
- **Do NOT** grant `create`/`delete` — the Owner creates/deletes alliances (AD-9 / FR-3); an Official
  only edits an existing assigned row.
- Confirm **`app_access: true`** on the policy (Officials use the Data Studio — §7 step 6). *(API login
  itself does not need it, but Studio editing does.)*

**Free interface guards (best-effort — reduce fat-finger edits, NOT security).** Because the update
grant is `fields:["*"]`, an Official can technically edit **any** field on **any** row, including
`slug` and `official`. Field-interface `meta` (app-level, **not** a permission rule, so it never 403s
and needs no license) narrows the *accidental* surface in the Studio:

- **`slug`** → on the field, add a **condition** *readonly when `id` is not empty* (`rule:
  { id: { _nnull: true } }`, `readonly: true`). This makes `slug` editable only while creating a new
  row and readonly on every existing row **in the Studio UI** — so the Owner can still type a slug at
  creation but nobody edits it afterward *in the Studio* (a direct API call still reaches it — see the
  honest limits below). **Free — the `meta` config applies without 403; the readonly-after-create
  behavior is a Studio-interface effect (design-asserted, not exercised by the raw-API proof).** This
  addresses the Story 4.1 review **D2** ("back the immutable-slug claim with the free `readonly` lever")
  without the plain global `readonly`, which would also block the Owner's own slug authorship —
  **closed as a manual Data-Studio step, not a reproducible artifact** (see the schema-sync note below).
  > **Schema out-of-sync (honest reproducibility note).** This guard is **field-interface config**,
  > which a `schema snapshot` *does* capture (unlike permissions) — but Story 4.2 makes **no
  > `directus-schema.yaml` change** (Task-5 scope fence), so the committed schema still shows `slug`
  > `readonly: false`. The guard lives in `data.db` (daily backup, §3) and **must be re-applied by hand
  > after a from-scratch `schema apply` rebuild**; a daily-backup restore preserves it. Re-snapshot
  > `directus-schema.yaml` if you ever want the guard reproducible from the schema itself.
- **`official`** → protecting it from an Official is **per-role field control = 🔒 licensed**, so there
  is no free rule that hides it from an Official while keeping it editable for the Owner. A **global**
  `official` `readonly`/`hidden` is free but also blocks the **Owner's** assignment (§9.3), so it is
  **not** recommended; `official` stays **Owner discipline + the honest limit** (the accepted Option-3
  answer).

> **Honest Option-3 limits (NFR-9 — what is / isn't server-enforced).**
> **Server-enforced (free, proven):** a leader **without** `alliances-official` gets **403** on any
> `alliances` write (the collection boundary); the **Owner** (Administrator) overrides any row.
> **NOT server-enforced (the ratified softening):** an Official editing **another** Official's row, or
> writing **`official`**/**`slug`** on any row — the `fields:["*"]` grant permits it and a direct API
> call reaches it. The practical mitigations are the interface guards above, Owner discipline in the
> Data Studio, and the daily `data.db` backup. Flip the 🔒 row filter + field subset back on if Directus
> is ever licensed (Option 1) — no spec change, just the grant.

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

### Role model (Story 3.3) — verified against real `directus/directus:12.0.2` (Core tier)

Live raw-API proof on the dev box (`docker compose up directus`, fresh DB, 20/20 checks):

- **AC3 — deny-by-default 403:** a non-admin leader → **403** on `POST`/`PATCH`/`DELETE` to
  `directus_users` / `directus_roles` / `directus_policies` (the AD-9 privilege-escalation
  guard). ✅
- **AC4 — Owner override:** the Administrator succeeds on the same writes (admin bypass). ✅
- **Collection-level RBAC works free:** a full `read` grant on a collection flips the leader
  from 403 → 200; `/permissions/me` reflects it (`access: full`) — the 3.5 role-chip seam. ✅
- **Public is locked:** unauthenticated `GET /users` / `/roles` / `/policies` → **403**. ✅
- **⛔ License gate (verified, not a bug):** every **custom permission rule** — item/row filter
  (`$CURRENT_USER`, AD-5), field-level subset (AD-6), validation, presets — is rejected at
  creation with **`403 RESOURCE_RESTRICTED`** on the unlicensed Core tier. So AD-5 (Alliance
  Official own-row) and AD-6 (Guides publish gate) are **not** enforceable until the licensing
  decision in `roles-and-policies.md` §0 is made. **Faithfully reported: these row/field
  boundaries were NOT verified working — they were verified *blocked*.**

**Deferred (provable only when the domain collections exist, Epics 4–6):** the per-collection
403s (Viewer-on-`candidates`, Editor-can't-publish, Official-cross-row). The **mechanism** is
proven here at collection granularity; the per-collection targets and the row/field grants land
with their collections (and require the §0 license for the granular half). The **production**
role model is applied on the host per §7 and captured by the daily backup — the local DB used
for this proof is throwaway (`down -v`).

### Account administration (Story 3.4) — verified against real `directus/directus:12.0.2` (Core tier)

Live raw-API proof on the dev box (throwaway git-ignored `infra/.env` with
`ADMIN_EMAIL=admin@example.com`, `docker compose up -d directus`, fresh DB, probe run **inside**
the container, **22/22 checks**, torn down with `down -v`). This re-proves the **account slice**
of the AD-9 `users / roles / policies → Owner` boundary (Story 3.3 proved the system-collection
writes generally; 3.4 proves account create + role/policy change specifically) and the **policy
union** (AC3):

- **AC1 — Owner-only account & role administration:** a **non-Owner** leader (base `Leader` role,
  one read-only policy, `app_access: false`) → **403** on `POST /users` (create account), on
  `PATCH /users/:id` changing **another** user's `role` **and** `policies` (privilege escalation),
  on `POST /policies`, and on `PATCH /roles/:id`. The **Owner** (Administrator) → **200** on
  `POST /users` and on changing a user's role. Unauthenticated `GET /users` → **403**. ✅
- **AC3 — per-area policies union independently:** two collection-level (license-free) read
  policies on two different existing system collections (`directus_dashboards`, `directus_files`)
  attached to one leader → `GET /permissions/me` returns **both**; functional reads confirm the
  **union** *and* **independence** — leader-A (dashboards only): `/dashboards` 200 / `/files` 403;
  leader-B (files only): the mirror; leader-AB (both): both 200. The production
  `transfer-viewer` + `guides-editor` union is the **identical** mechanism, provable once those
  domain collections land (Epics 5/6). ✅
- **Bootstrap fix confirmed:** `ADMIN_EMAIL=admin@example.com` (the Task-1 `.invalid` → RFC-2606
  fix) is accepted by Directus's email validator and the bootstrap admin logs in. The probe
  incidentally re-confirmed that Directus rejects **reserved TLDs** — `@…test` account creates
  failed the same way `.invalid` does — so `example.com` (a real, reserved-for-docs domain) is
  the correct obviously-fake default. ✅

**Not verified here (honest limits):** the **suspended/archived login-block** (§8.5) and the
**`/users/invite`** flow (both Directus built-ins, not exercised by this proof); domain-collection
role behavior (`transfer-viewer`/`guides-editor` on `candidates`/`guides`) — those collections
don't exist yet (Epics 5/6); the built-in email password-reset round-trip
(`/auth/password/request` needs SMTP — a host concern); and everything already flagged host-only
above. The **production** account state
is authored in the Data Studio per §8 and captured by the daily `data.db` backup — the local DB
used for this proof is throwaway.

### Alliances collection (Story 4.1) — verified against real `directus/directus:12.0.2` (Core tier)

Live raw-API proof on the Windows/Docker dev box (disposable `directus:12.0.2` container, fresh DB,
Owner/admin session, torn down after). The container's DB was kept on the container overlay FS to
sidestep the Windows named-volume SQLite `CANTOPEN` quirk — schema/field/seed behavior is identical:

- **AC1 — canonical shape:** `alliances` created with `id` (int auto PK) + `name`, `slug`,
  `bear_trap_1`, `bear_trap_2`, `peak`, `farm_alliance`, `official` — `snake_case`, plural. `slug`
  is **unique** + not-null (immutable kebab-case by convention). `official` is a real **M2O →
  `directus_users`** (`ON DELETE SET NULL`). ✅
- **AC2 — two scalar Bear Traps:** `bear_trap_1` + `bear_trap_2` are two **independent nullable
  `time`** fields — no array, no relation, no `special`. ✅
- **AC3 — clean seed:** all **5** rows imported from `alliances.json` (six scalar fields); the `516`
  slug stored as a **string** (no numeric coercion); `farm_alliance` casing verbatim
  (`rok` / `CAT` / `AcE`); `peak` null on every row; `official` null on every row. SQLite stored the
  `HH:MM` Bear-trap values **verbatim** (`00:30` stayed `00:30` — no `:00` normalization; clean for
  the Story 4.3 read path). ✅
- **AC4 — Owner CRUD + assign Official:** the Owner (Administrator) created, edited, and deleted a
  throwaway row, and set a row's `official` M2O to a `directus_users` id (assignment persisted). ✅
- **License does not bite 4.1 (verified):** every step returned 2xx — **no `403
  RESOURCE_RESTRICTED`**. Collection/field/relation creation and Owner CRUD are free Core-tier (admin
  bypass); the 🔒 gate is Story 4.2's `official = $CURRENT_USER` row filter. ✅
- **Snapshot fidelity:** `directus schema apply --dry-run infra/directus-schema.yaml` → **"No changes
  to apply"** — the committed snapshot is a faithful, replayable capture of the live schema.

The **production** collection is created on the host per §9 (or `schema apply`) and captured by the
daily `data.db` backup — the local DB used for this proof is throwaway.

### Alliance Official editing (Story 4.2) — verified against real `directus/directus:12.0.2` (Core tier)

Live raw-API proof on the Windows/Docker dev box (disposable `directus:12.0.2` container, `LICENSE_KEY=""`,
fresh DB on the container overlay FS, brought up **via PowerShell** to avoid the Git-Bash/MSYS
`SQLITE_CANTOPEN` path-mangling wall; **every check below passed**; container torn down after, the 3.5-leftover
volumes `k1516db`/`k1516vdb` left untouched for the Owner to prune). The proof creates the `alliances`
collection, a base `Leader` role, the `alliances-official` policy with the §9.4 grants, a throwaway
Official (assigned as one row's `official`) and a policy-less plain leader:

- **AC3 — the free editing path:** the Official `PATCH`es **their own** alliance's
  `name`/`bear_trap_1`/`bear_trap_2`/`peak`/`farm_alliance` → **200** (no `403 RESOURCE_RESTRICTED` — the
  `fields:["*"]`,`permissions:{}` read+update grant is free Core-tier). ✅
- **AC2 — collection boundary (server-enforced):** a leader with **no** `alliances-official` policy →
  **403** on `PATCH /items/alliances/:id` (deny-by-default). ✅
- **AC4-style Owner override:** the Owner (Administrator) edits **any** alliance row → **200** (admin
  bypass). ✅
- **Honest Option-3 non-enforcement (recorded, not hidden — NFR-9):** the same Official **can also**
  `PATCH` **another** alliance's row → **200**, and write **`slug`** → **200** (AR-18 exposure) and
  **`official`** → **200** (AD-9 exposure) on any row — because the free grant is `fields:["*"]` with no
  row filter. This is the ratified softening; the §9.4 interface guards + Owner discipline + daily backup
  are the practical mitigation, **not** a server riegel. ✅ (behaves exactly as documented)
- **⛔ License gate re-proven (confirms `fields:["*"]` is correct as-built):** attempting to create the
  **field-subset** update grant **or** the **row-filter** (`official = $CURRENT_USER`) update grant each
  returns **`403 RESOURCE_RESTRICTED`** (`custom_permission_rules_enabled is a restricted resource`) — so
  the Option-1 target is genuinely licensed and the full-collection grant is the only free path. ✅
- **Free interface guards (Task 2):** setting the **`slug`** field's `conditions` (readonly when `id` is
  not empty) → **200** (free interface `meta`, no 403 — the config is *accepted*; the readonly-after-create
  behavior is a Studio-UI effect this raw-API proof does **not** exercise); a **global `official`
  `readonly`** → **200** (free, but it also blocks the Owner's assignment, so it is left optional — §9.4). ✅

The **production** grant is authored in the Data Studio per §9.4 and captured by the daily `data.db`
backup — the local DB used for this proof is throwaway. **ZERO `site/` change** and **no
`directus-schema.yaml` change** (permissions are not in a schema snapshot — §6).
