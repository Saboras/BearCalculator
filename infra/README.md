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
NFR-18). The public Finder sources this collection at **build time** via a read-only token
(Story 4.3 — see **§9.5**); an alliance edit fires a rebuild so the change goes live after a
~1–3 min build, with no runtime fetch on the public page (NFR-3 / AR-4).

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

### 9.5 Build-time Finder read + rebuild-on-publish (Story 4.3)

The public Finder reads `alliances` at **build time** (SSG), never at runtime (NFR-3 / AD-1 / AD-2).
The Astro build (off-box CI, AD-16) pulls the collection with a **read-only static token** (AR-18) and
bakes the rows into static HTML; a Directus edit fires a **Flow → `repository_dispatch`** that rebuilds.

**A. Read-only build token + grant** (mint once; lives only in `data.db`, backed up per §3):

1. **Settings → Access Policies → +**: create a policy `finder-build-read`. Add **one permission**:
   collection `alliances`, action **read**, **no filter, all fields** — a whole-collection read grant
   (**free on Core**; only row/field-filtered rules are 🔒 licensed, §0). **Story 5.2 adds one more read
   to this same policy** — `transfer_period` (whole-collection read, for the active period id the apply
   form bakes; see §11). It gets no write and no other collection.
2. **Settings → Users → +**: create a service user `finder-build` (no app/admin access), attach **only**
   the `finder-build-read` policy. Under its **Token** field, generate a **static access token** and copy it.
3. Store the token as the **`DIRECTUS_TOKEN`** GitHub Actions **secret** (Settings → Secrets → Actions) and
   in local `site/.env`. It is build-only and **non-`PUBLIC_`** — never in the client bundle
   (`site/src/lib/directus-build.ts` reads it from `process.env`). Also set the repo **variable**
   `PUBLIC_DIRECTUS_URL` = the live `DIRECTUS_DOMAIN` (`https://…`). Both are wired into the `deploy.yml`
   "Build static site" step. **Public stays locked** — the anonymous role gets no `alliances` read.

   > Toggle: with `DIRECTUS_TOKEN` unset/placeholder the build falls back to the committed
   > `site/src/data/alliances.json` seed and stays green — so CI is not blocked before the token exists.
   > A real token switches the Finder to live Directus data. A configured-but-failing read (bad token/URL,
   > Directus down) **fails the build loud** — it never ships a stale or empty Finder.

4. **Verify** (raw API, from anywhere that can reach Directus):
   ```bash
   curl -s -H "Authorization: Bearer <DIRECTUS_TOKEN>" \
     "https://<DIRECTUS_DOMAIN>/items/alliances?fields=name,slug,bear_trap_1,bear_trap_2,peak,farm_alliance&limit=-1"
   # → 200 + the rows.  Without the token → 401/403 (Public has no alliances read).
   ```

**B. Alliances publish Flow** (attach now that the collection exists — Story 4.1 deferred it to here):

5. **Settings → Flows → +**: trigger **Event Hook → Action (non-blocking)** on
   `items.create`, `items.update`, `items.delete` for **`alliances`**. Add a **Webhook / Request URL**
   operation POSTing the GitHub dispatch from §4:
   ```
   POST https://api.github.com/repos/<owner>/<repo>/dispatches
   Authorization: Bearer <fine-grained PAT, "Dispatch" / contents scope>
   Accept: application/vnd.github+json
   Body: {"event_type":"directus-publish"}
   ```
   The GitHub receiving end is already wired (`deploy.yml` `repository_dispatch: [directus-publish]`, §4).
   Store the PAT inside the Flow operation (Directus secret), never in git. Publish is live after the
   ~1–3 min rebuild (NFR-4) — no staging, by design.

6. **Verify** the Flow fires the dispatch by editing any `alliances` row and confirming a new **Build site**
   run appears in GitHub Actions (or use the manual `curl` dispatch in §4). Live Flow verification needs a
   real VPS + PAT, so it is a **host/launch step** (same posture as the §4 webhook).

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

## 10. Candidates, transfer_period & settings (Story 5.1)

Epic 5 (Transfer Pipeline) opens with the **data model + game-rule config** the whole pipeline
reads. Like §9 (alliances), this is a **pure Directus + docs** slice: the collections live in
`data.db` (daily backup, §3) and are captured in `infra/directus-schema.yaml` (the replayable
snapshot — collections/fields/relations only, **no** permissions, **no** data, §6). **ZERO
`site/` change** — the public apply form is Story 5.2, the leader read UI is 5.4, the status
lifecycle UI is 5.5. Authored in the Data Studio (AD-3) or replayed with `schema apply` (§9 / §6).

**Ordering (create the M2O targets first):** `transfer_period` → `settings` → `transfer_groups`
→ `candidates` (which relates to `alliances` from §9 plus the three new collections). A
`schema apply infra/directus-schema.yaml` orders it for you.

### 10.1 `candidates` — the applicant record (FR-4)

Core applicant fields + lifecycle + the two distinct-writer alliance relations + `group` + `period`.
`snake_case`, integer PK. "Req" = the public form's required set (Story 5.2).

| Field | Type | Req | Writer (AD-9) | Note |
|---|---|---|---|---|
| `character_name` | string | ✓ | public create-only | in-game character name |
| `player_id` | string | ✓ | public create-only | **the in-game contact key** (FR-4) |
| `kingdom_number` | integer | ✓ | public create-only | current kingdom # |
| `timezone` | string | ✓ | public create-only | IANA tz / offset (new vs old form) |
| `who_invited` | text | ✓ | public create-only | referral / social vetting |
| `why_leaving` | text | ✓ | public create-only | |
| `team_player_kvk` | boolean | ✓ | public create-only | KvK / save-troops willingness |
| `others_transferring` | text | ✓ | public create-only | names — seeds group linking (5.6) |
| `day4_fcfs` | boolean | ✓ | public create-only | Day-4 FCFS (Random-ask readiness) |
| `needs_special_invite` | boolean | ✓ | public create-only | >130M flag (FR-5 / 5.3) |
| `what_you_seek` | text | — | public create-only | optional |
| `players_to_avoid` | text | — | public create-only | optional |
| `desired_alliance` | M2O → `alliances` (SET NULL) | — | **public form only** | AD-8 — player's own choice |
| `suggested_alliance` | M2O → `alliances` (SET NULL) | — | **Curator only** | AD-8 — leader's recommendation; separate relation |
| `status` | dropdown | ✓ | Curator | `Applied\|Accepted\|Transferred\|Rejected`; default **`Applied`** |
| `planned_path` | dropdown | — | Curator | `Invite\|Special\|Random-ask`; set on Accept (5.5) |
| `group` | M2O → `transfer_groups` (SET NULL) | — | Curator | friend-group link (5.6) |
| `period` | M2O → `transfer_period` (NO ACTION) | ✓ | public create-only | stamped to **active** period at create, **never re-stamped** (AD-17) |

- **Two SEPARATE alliance relations (AD-8).** `desired_alliance` and `suggested_alliance` are
  **distinct** M2O → `alliances`, **never auto-copied**. This two-relation shape *is* the
  "distinct writers" invariant at the data-model level — the write-side enforcement is an Option-3
  convention on Core (§10.6).
- **`status`** default **`Applied`** (FR-4); the transition order is **UI-guided only** — **no**
  Directus Flow/hook/state machine (AR-9/AD-7).
- **`period`** required; **on-delete `NO ACTION`** — periods are long-lived (you delete terminal
  *candidate* rows at window close, never the period).
- **No `entry_route`, no random-entries counter, no stored per-path counter / divergent flag /
  carry-over** — dropped (AR-19) or edge-computed by a later story (5.6/5.7/5.8).

### 10.2 `transfer_period` — per-window caps + active flag (AD-11 / AD-17)

**Multi-row**, exactly **one `active`** at a time; **Owner-written** (no non-Owner write grant —
§7 / roles-and-policies AD-9). Fields: `name` (window label), `invited_cap`, `random_cap`,
`special_cap`, `active` (bool). **The available-special-count this period lives ONLY on
`special_cap`** — never in the settings singleton, never a second store (AD-11). **No counter/tally
field** — counters are edge-computed (5.7) and are **planning aids, never a gate**.

### 10.3 `settings` — kingdom-wide thresholds (singleton)

A **singleton** collection (`singleton: true` — "Treat as single object") holding **only** the
kingdom-wide game rules: `special_invite_power_threshold` (**130000000** — the 130M special-invite
power, FR-5) and `transfer_cadence_weeks` (**8** — the ~8-week cadence). **Never a special count**
(AD-11). Owner-written.

### 10.4 `transfer_groups` — friend-group shell (5.6)

Minimal shell so `candidates.group` has a target: integer PK + optional `name`. **No
`suggested_alliance` column** — a group-level suggestion is a **UI fan-out** that writes each
member's `candidates.suggested_alliance` in one transaction (AR-10). Grouping CRUD/UI is Story 5.6.

### 10.5 Author the config rows (the "never hardcoded" numbers — NFR-17)

The caps and thresholds are **editable data rows**, not code literals:

- **`transfer_period`**: one row per window; for **2026-07-19** set `invited_cap = 35`,
  `random_cap = 20`, `special_cap = 2`, `active = true`. (At window close, create the next row and
  flip `active`.) The `special_cap` +1/event regen (cap 3) is **manual Owner guidance** when setting
  the next cap — **not** stored live state.
- **`settings`**: set `special_invite_power_threshold = 130000000`, `transfer_cadence_weeks = 8`.
- **`candidates`** and **`transfer_groups`** start **empty** — candidates arrive via the 5.2 form.

> **Preconditions after a `schema apply` rebuild (the snapshot carries no data, §6 / §10 intro).** A
> from-scratch replay recreates the collections but **not** these config rows — re-author them before the
> pipeline works:
> - **Exactly one `transfer_period` with `active = true`.** With **zero** active, the required `period`
>   stamp on a public create (5.2) has nothing to point at and intake fails (loud, but a cryptic NOT-NULL
>   error); with **two or more** active, the stamp is ambiguous and the AD-17 carry-over query
>   double-counts across windows. Exactly-one is **Owner discipline** — a uniqueness/validation guard is
>   🔒 licensed on Core (§0), so it is not server-enforced.
> - **`settings.special_invite_power_threshold` set.** It feeds the 5.3 `/join` power-badge compare, baked
>   at build (§11.6). Left null it *would* be fail-**silent** (a `power > null` compare misclassifies every
>   applicant), so **Story 5.3 makes it fail-loud at build**: a configured build with a null / non-positive
>   threshold **throws** in `transfer-build.ts` (mirroring the exactly-one-active-period throw) — a broken
>   classifier never ships. Re-author the value here after a from-scratch replay before rebuilding.

### 10.6 What's deferred, and what the Core license does NOT enforce

Per the §9 (4.1) precedent, Story 5.1 lands the **shape + config only**. **No permission grants are
wired here** — they attach as each consuming story lands (roles-and-policies §3):

| Grant | Story |
|---|---|
| Public **create-only** on `candidates` (no read) | 5.2 |
| `transfer-viewer` **read** `candidates` / `transfer_period` (+ `alliances` for M2O names) | ✅ **delivered 5.4**; counter denominators consumed ✅ **5.7** (§15) |
| `transfer-curator` **update** work-fields on `candidates` | ✅ **delivered 5.5** (also carries `suggested_alliance` / `group` for 5.6) |
| `transfer-curator` **delete** `candidates` | 5.8 |
| `transfer_groups` **CRUD** (Curator) | ✅ **delivered 5.6** (§14) |
| `transfer_period` write | **never** to a non-Owner — Owner-only (AD-9) |

**Licensing (Core tier — see roles-and-policies §0).** The *shape* above is all **free**. Enforcing
the finer boundaries needs **custom permission rules**, which **403 `RESOURCE_RESTRICTED`** on Core
(re-proven for `candidates` in the verification block below): the **distinct-writer** split (a field
subset limiting the Curator to work-fields, AD-8/AD-9) and the **`period` never-re-stamped**
immutability (a field exclusion / validation, AD-17) are **🔒 licensed**. Under the ratified
**Option 3**, both ship as **UX + Owner-discipline conventions, NOT server-enforced** — a Curator's
future full-collection update grant (5.5) *can* touch the public core / `desired_alliance` and *can*
re-stamp `period` (the latter is **silent** carry-over corruption — the decision-needed AD-17 item
in `deferred-work.md`). The collection **boundaries** stay server-enforced (a Viewer gets 403 on any
write; Public is locked; Owner overrides). Flip the 🔒 rules on the moment Directus is licensed
(Option 1) — no schema change, just the grant.

## 11. Public transfer application form + create-only grant (Story 5.2)

The public **on-site apply form** at `/join` (`site/src/pages/join.astro`) **replaces** the MVP-1
Google-Form hand-off (AR-3's one permitted additive public-flow change). It posts a new `candidates`
row **directly** to the Directus API as the **create-only unauthenticated role** (AD-12) — no custom
backend, no runtime read. `status` defaults to `Applied`; the submitter sees a confirmation naming the
next window + the in-game Player-ID contact.

### 11.1 The Public create-only grant (mint once; lives in `data.db`, backed up §3)

**Settings → Access Policies → `Public` (built-in) → Permissions**, on `candidates`:

| Action | Fields | Filter (`permissions`) | Note |
|---|---|---|---|
| **create** | `["*"]` | none (`permissions: {}`) | ✅ free — the only free create shape (§0) |
| **read** | — | — | **NOT granted** — deny-by-default → write-only (AD-12) |

- **Do NOT** author a `preset` forcing `period`/`status`, a field subset, or a validation rule — each is
  a 🔒 custom permission rule → `403 RESOURCE_RESTRICTED` on Core (§0). Payload discipline lives at the
  form edge instead (below). The grant lives only in `data.db` (backup §3), **not** in
  `directus-schema.yaml`. Source of truth: `roles-and-policies.md` §3 (Public) / §4 mechanism 3.

### 11.2 What the form bakes at build time (why it needs no runtime read)

The public role has **no read**, and no public page fetches Directus at runtime (NFR-3). Everything `/join`
needs is therefore **baked at build time** (SSG), via the same `finder-build-read` token the Finder uses
(§9.5):

- **the alliance `slug → id` map** — `desired_alliance` is an M2O → `alliances.id`; the form resolves the
  Finder's `?alliance=<slug>` to an id at submit. `site/src/lib/transfer-build.ts` reads
  `alliances{id,slug,name}` in its **own** build read, so the Finder's idless reader
  (`directus-build.ts`) stays byte-for-byte untouched.
- **the active `transfer_period` id** — stamped into `candidates.period` (AD-17). This requires the
  **read grant** on the `finder-build-read` policy: **`transfer_period`, action read, all fields, no
  filter** (whole-collection, ✅ free — §0). Add it alongside the existing `alliances` read (§9.5 A.1).
- **the `special_invite_power_threshold`** (Story 5.3) — read from the `settings` singleton so `/join` can
  classify the applicant's power at the edge (badge + the recorded `needs_special_invite` boolean; §11.6).
  Not a value the row stores — a client-side compare only. This requires a **read grant** on the
  `finder-build-read` policy: **`settings`, action read, all fields, no filter** (whole-collection, ✅ free
  — a field-subset read would be 🔒, §0). Add it alongside the `alliances` + `transfer_period` reads.
  **Rebuild-to-change:** the threshold is baked at build, so raising it in the Studio needs a **site
  rebuild** before `/join` reflects the new value — the same build-time staleness as the active period
  (cross-ref §10.5 / §11.6).

> **Rebuild-on-period-flip precondition.** The active period id is only as fresh as the last **site
> build**. Candidates do **not** trigger a rebuild (client-fetched, never SSG — §10), and there is **no
> Flow on `transfer_period`**. So after the Owner flips the active period (§10.5), the **site must be
> rebuilt** before `/join` stamps the new period. Cross-ref §10.5 (exactly-one-active).

> **Build toggle (mirrors §9.5).** No token → `/join` builds from the seed alliance list with no ids and
> no active period (CI/local stay green); the form renders but cannot POST — expected pre-launch. A
> configured-but-failing read, or ≠1 active period, **fails the build loud** (never ships a broken form).

### 11.3 Required-field backstop (`meta.required` + re-snapshot)

The `candidates` NOT-NULL fields carried `meta.required: false` (5.1), so a create omitting one returned
a raw DB NOT-NULL error, not a clean 400. Story 5.2 sets **`meta.required: true`** on the NOT-NULL set
(`character_name`, `player_id`, `kingdom_number`, `timezone`, `who_invited`, `why_leaving`,
`team_player_kvk`, `others_transferring`, `day4_fcfs`, `needs_special_invite`, `status`, `period`) in the
Studio, then **re-snapshots** `directus-schema.yaml` (§6). This is a schema **field** property (free —
NOT a permission rule); it is the clean-400 server backstop to the form's own required-field UX.

> **Caveat — the backstop only fires for the eight default-null fields.** `status` (`default_value: Applied`)
> and the three Yes/No booleans (`team_player_kvk` / `day4_fcfs` / `needs_special_invite`, each
> `default_value: false`) carry a DB default, so a create that *omits* one is silently defaulted
> (`status → Applied`, booleans → `false` = "No"), **not** rejected — the `required` check is satisfied by
> the default. The clean-400 therefore covers only the eight default-null fields (`character_name`,
> `player_id`, `kingdom_number`, `timezone`, `who_invited`, `why_leaving`, `others_transferring`, `period`).
> Inert for the form (it always sends the three booleans and deliberately omits `status`); it matters only
> for a direct API poster, where an omitted `needs_special_invite` silently stores as "No" (feeding the 5.3
> special-invite routing).

### 11.4 Abuse floor (AD-12 / NFR-11) — rate limiter + honeypot, no captcha

- **Directus IP rate limiter** — `RATE_LIMITER_ENABLED/STORE/POINTS/DURATION` in `docker-compose.yml`
  (50 req/s per IP, in-memory). The server-side floor, effective even against direct API posts. Global
  per-IP — generous for ~10 leaders + the Studio's many calls, throttles a single-IP flood.
- **Honeypot** — a hidden decoy field on the form; a filled decoy is silently dropped client-side
  (best-effort; a direct API poster bypasses it — the rate limiter is the real floor).
- **No captcha** — deferred until real abuse appears (AD-12). The **Caddy-scoped `rate_limit`** (AD-12's
  letter, `POST /items/candidates`) is the documented upgrade if the global limiter proves too blunt — it
  needs the `caddy-ratelimit` plugin + a custom `xcaddy` image (replacing the pinned official image), so
  the native limiter is the KISS choice (Sabo, 2026-07-08 / Q1).

### 11.5 CORS + transport

The browser POSTs cross-origin from the apex (`SITE_DOMAIN`) to the admin subdomain (`DIRECTUS_DOMAIN`).
`docker-compose.yml` already sets `CORS_ORIGIN=https://${SITE_DOMAIN}` (§Auth model) — the anonymous POST
is allowed; **no compose change for the origin**. The POST carries **no cookie/token** (create-only
role), so the session-cookie / `CORS_CREDENTIALS` settings are irrelevant to it. Submission is JS-driven
`fetch` (`output: 'static'` — no server endpoint); a no-JS visitor sees the form but a "needs JavaScript"
note (progressive enhancement, like `/leader`).

### 11.6 Special-invite flag — power > threshold (Story 5.3)

The old self-declared "Need a special invitation? Yes/No" field is **replaced** by a **power** input: the
applicant enters power **in millions** (e.g. `145`), the client multiplies ×1,000,000 and compares to the
**build-baked** `special_invite_power_threshold` (raw units). Over the limit → the danger-tinted
special-invite **badge** shows live and the create posts `needs_special_invite: true`; at/under → no badge,
`false`. **Strictly `>`** (exactly at the limit does not flag). Power is a **client-side classifier only** —
never sent, never stored (there is no `power` column). The threshold reads from **editable config**, never a
literal (NFR-17 / AR-13); the badge copy names the **live** baked value so it never rots as the limit rises.

- **Read path:** the `finder-build-read` token's whole-collection `settings` read (§11.2), baked into the
  `/join` `apply-config` JSON and resolved client-side. **Not** a Public read (AD-12 keeps Public
  write-only) and **not** a runtime fetch (NFR-3).
- **Null-threshold guard (fail-loud):** a configured build with a null / non-positive
  `special_invite_power_threshold` **throws** in `transfer-build.ts` — never a silent misclassifier (§10.5).
- **Rebuild-to-change (tracked open point).** The threshold is baked at build, so **raising it in the
  Studio needs a site rebuild** before `/join` reflects it (same build-time staleness as the active period).
  Because the Owner raises the limit over time, the "public form reads the threshold **live**, no rebuild"
  idea is tracked as a correct-course candidate (`deferred-work.md`), grouped with the 5.2 live-window
  question — **not** built here (a live public read would relax AD-12 + hit the Core field-subset wall).

## 12. Candidate list — Viewer read grant + admin shell (Story 5.4)

The `/admin` Candidates tab (a placeholder since Story 3.5) now shows a **read-only** list of every
candidate for any leader with **Read+ on Transfer**. This is the **first feature that reads
authenticated candidate PII and renders it** — and it is a **runtime, client-side, session-cookie
read** (`site/src/lib/directus.ts` → `getCandidates()`), **never** baked into static HTML (AD-1/AD-2).
Consequence for the Owner: the list is **live** — a Curator's change (5.5+) shows on the next shell
load with **no rebuild**. No `site/` build data and no schema change; the whole story is two `site/`
source edits + this grant (lives in `data.db`, backed up §3).

### 12.1 The `transfer-viewer` read grant (mint once; `data.db`, not the schema snapshot)

On the **`transfer-viewer`** policy (roles-and-policies §3), add three **whole-collection reads**
(`fields:["*"]`, no filter — the only **free** shape on Core; a field subset or row filter is 🔒
`403 RESOURCE_RESTRICTED`):

| Collection | Why |
|---|---|
| `candidates` | the list itself — a Viewer sees **all fields of all rows** (transparency-by-design; you cannot license-free hide a column) |
| `transfer_period` | window context now; counter denominators at 5.7 |
| `alliances` | so the list resolves `desired_alliance` / `suggested_alliance` M2O → **name** live at runtime (Option B, Sabo 2026-07-09). Free; alliance data is already public (Finder). The list *query* deep-expands only `id`+`name`, so the candidate list never **surfaces** `official` — but the Core-forced `["*"]` grant does technically let a Viewer **read** the `official` FK via the API (an opaque `directus_users` id only; no user PII without a `directus_users` read grant, which Viewers lack) |

A **Curator** gets its own `candidates` read at 5.5 (Curator = Viewer + writes — don't stack both
policies). Public stays **no `candidates` read** (deny-by-default, AD-12). Assigning the actual ~8
leaders to `transfer-viewer` is the ongoing Owner task (§8.2) — this story wires the grant.

### 12.2 The gate is server-enforced (the absent tab is cosmetic)

A leader without Transfer access sees **no Candidates tab** (the shell resolves tabs from
`/permissions/me`, Story 3.5) — but that is **UX only**. The real boundary is Directus: an
unauthorized read returns **403** regardless (AD-4 / NFR-9). Never treat the hidden tab as security.

### 12.3 Local verification status (Story 5.4)

Verified against real `directus/directus:12.0.2` (Core, `LICENSE_KEY=""`) on the Windows/Docker box
(disposable container via PowerShell; committed `directus-schema.yaml` applied; torn down after):

- **AC1** — a leader on the base `Leader` role + `transfer-viewer` reads `GET /items/candidates` →
  **200**, all 19 fields on every row, with `desired_alliance.name` / `suggested_alliance.name`
  deep-expanded (e.g. `Kingdom 516`, `Frostborne`); `needs_special_invite`, `status`, `planned_path`
  all present. Viewer also reads `alliances` (200) and `transfer_period` (200).
- **AC2** — anonymous `GET /items/candidates` → **403 FORBIDDEN**; a leader **without** the transfer
  grant → **403 FORBIDDEN**.
- **License wall (crux c, re-proven)** — a **field-subset** read permission and a **row-filter** read
  permission on `transfer-viewer` each → **403 `RESOURCE_RESTRICTED`** at creation, so the free
  whole-collection read is the only shape and a Viewer necessarily sees all fields.
- **Divergent-group data** — two candidates sharing a group with two distinct `suggested_alliance`
  ids read back correctly, so the client edge-computation (danger left-rail) has what it needs (no
  `transfer_groups` read required — the group id + suggested id are on the candidate rows).
- **Build hygiene (Node 22)** — `dist/admin/index.html` has a linked stylesheet (CSS emitted — the
  Node-24 no-CSS hazard); **zero candidate rows** baked into the static admin HTML; the candidate
  read is runtime-only. `grep` of `dist/` finds only field-name identifiers + the SDK's session
  token-storage code (both inert; no candidate data, no real token).

## 13. Status lifecycle — Curator grants + admin controls (Story 5.5)

The **first Curator WRITE** from the admin shell. On the `/admin` Candidates tab, a Curator (or the
Owner) advances a candidate's status — `Applied → Accepted → Transferred / Rejected`, plus the
**Random exception** `Applied → Transferred` — and sets a **planned path** (`Invite` / `Special` /
`Random-ask`) on Accept. The write is a **runtime, client-side, session-cookie PATCH**
(`site/src/lib/directus.ts` → `updateCandidate()`), so the list stays **live** — the row re-renders in
place, **no rebuild**, no static-HTML data. **No schema change** (`status` / `planned_path` exist since
Story 5.1); the whole story is two `site/` edits + these grants (in `data.db`, backed up §3).

**The order is UI-guided only (AR-9/AD-7).** Directus enforces only **who** may write; the legal
transition graph lives in the admin client (`admin/index.astro` `allowedActions`). **No Directus Flow,
hook, validation, or state machine** encodes it — do not add one.

### 13.1 The `transfer-curator` grants (mint once; `data.db`, not the schema snapshot)

On the **`transfer-curator`** policy (roles-and-policies §3), add **whole-collection** grants
(`fields:["*"]`, no filter — the only **free** shape on Core; a field subset / row filter / validation is
🔒 `403 RESOURCE_RESTRICTED`). A Curator holds `transfer-curator` **instead of** `transfer-viewer`
(don't stack both), so this policy carries its own reads:

| Collection | Action | Why |
|---|---|---|
| `candidates` | **read** `["*"]` | Curator = Viewer + writes (sees all fields, like a Viewer) |
| `candidates` | **update** `["*"]` | the write grant — **AC2** (Curator 200 / Viewer 403). Whole-collection is the only free shape → a Curator *can* technically write the public core / `desired_alliance` / re-stamp `period`; the UI sends only `{status, planned_path}` (Option 3 — §13.3) |
| `transfer_period` | **read** `["*"]` | window context / 5.7 counter denominators |
| `alliances` | **read** `["*"]` | resolve `desired_alliance` / `suggested_alliance` M2O → **name** live (same deep-expand as the 5.4 Viewer list) |

Do **not** grant `candidates` **delete** (Story 5.8) or `transfer_groups` CRUD (Story 5.6). `app_access`
is **not** needed — the custom `/admin` shell uses the session REST API, not the Data Studio (§8.7 / §5).

### 13.2 The gate is server-enforced; the order is not

`Directus enforces WHO` (the collection-level update grant): a Curator's PATCH → **200**, a Viewer's (no
update grant) → **403**, anonymous → **403**, Owner (admin bypass) → **200**. The **transition order** and
"set a path on Accept" are **client guidance only** — a determined Curator could PATCH an illegal jump via
the raw API and Directus would allow it (AR-9). That is accepted: the ≤2 Curators are trusted, the shell
guides the legal path, and nothing security-relevant rests on the order.

### 13.3 The `period` re-stamp — Option 3, and why the UI never sends `period`

The whole-collection update grant (§13.1) exposes `candidates.period`, which AD-17 marks **never
re-stamped**. A re-stamp is **silent carry-over corruption** (it erases the "from a prior period" identity
that the 5.7 carry-over query derives; nothing detects or repairs it). **Decision (Sabo, Story 5.5,
2026-07-09): Option 3** — accept the free whole-collection grant, keep `period` immutability as discipline,
and the **admin UI sends only `{status, planned_path}`, never `period`** (`writeCandidate`; the shell
exposes no `period` control). So a re-stamp cannot happen on the normal work path — only a hand-crafted
raw-API call or a bug could, which is proportionate for the ≤2-trusted-Curator scope + daily backups. The
Option-1 upgrade (license → the field-subset grant + `period`-immutable validation work server-side) stays
a clean, spec-unchanged flip if trust assumptions ever change.

### 13.4 Local verification status (Story 5.5)

Verified against real `directus/directus:12.0.2` (Core, `LICENSE_KEY=""`) on the Windows/Docker box
(disposable container via PowerShell; committed `directus-schema.yaml` applied — "Snapshot applied
successfully"; torn down after). All `transfer-curator` grants created **200** (free whole-collection):

- **AC1 / AC3** — Curator PATCH `{status:'Accepted', planned_path:'Invite'}` → **200**, echoes
  `status=Accepted`, `planned_path=Invite` (Accept sets both in one write — never leaves a null path).
- **AC4** — Curator PATCH `{status:'Transferred'}` on the Accepted row → **200**, `status=Transferred`,
  `planned_path` **unchanged** (`Invite`) — status only, no entry route (AR-19).
- **AC1 (Random exception)** — Curator PATCH `{status:'Transferred'}` on an `Applied` candidate → **200**
  (direct `Applied → Transferred`).
- **AC2** — a **Viewer** (`transfer-viewer`, no update grant) PATCH → **403**; **anonymous** PATCH →
  **403**. **Owner** PATCH → **200** (admin bypass).
- **License wall (re-proven, confound-free)** — on a fresh policy, a whole-collection read grant → **200**
  but a **field-subset** read grant → **403** (`RESOURCE_RESTRICTED`, §0); a field-subset + validation
  **update** grant on `transfer-curator` → **403**. So the free whole-collection update is the only shape.
- **Honest Option-3 limit (§13.3)** — a Curator PATCH `{period:<other id>}` under the full grant → **200**
  (the silent re-stamp vector — exactly why the UI never sends `period`).
- **Build hygiene (Node 22)** — `dist/admin/index.html` has a linked stylesheet (CSS emitted — the Node-24
  no-CSS hazard); the control code (`Mark Transferred`, `.cand-btn--*`) is in the admin bundle + CSS; the
  candidate write is runtime-only, **zero** candidate data / session token baked into the static HTML.
- **Transition legality (pure-logic unit test)** — 26/26: the per-status action sets, the Random
  exception, Accept-always-carries-a-path, Mark-Transferred-is-status-only (no `entry_route`), the
  `Special` value ↔ "Special invite" label mapping, and "no emitted patch ever writes `period`".

## 14. Grouping & alliance suggestion (Story 5.6)

The **second Curator write surface**. On the `/admin` Candidates tab a Curator (or Owner) now **links
friends into a transfer group** and **sets a suggested alliance** — a *recommendation, never a placement*
(AD-8) — at candidate **or** group level. All writes are **runtime, client-side, session-cookie**
PATCH/POST via `site/src/lib/directus.ts` (`updateCandidate` / `updateCandidates` / `createGroup` /
`deleteGroup`); the list stays **live** (no rebuild, no static-HTML data). **No schema change** —
`transfer_groups` + the `candidates.group` / `candidates.suggested_alliance` M2O relations exist since
Story 5.1.

- **Grouping** writes `candidates.group` (M2O → `transfer_groups`). "Link group" mints a `transfer_groups`
  row (`createGroup`) then batch-stamps membership (`updateCandidates([ids], {group})`); unlinking sets
  `{group:null}` and **dissolves** a group that drops below 2 members (`deleteGroup`; `on_delete: SET NULL`
  un-links, never deletes candidates). A **gold** left-rail accent marks linked members.
- **Suggested alliance** writes `candidates.suggested_alliance` (M2O → `alliances`). "Set for whole group"
  is the **atomic fan-out** — one `PATCH /items/candidates` with `{keys, data}` (`updateItems`) sets every
  member to the same value **in one transaction** (AR-10). `transfer_groups` has **no** suggested column.
- **Divergent flag** — a group with **≥2 distinct non-null** suggested alliances renders a **danger**
  left-rail + "Group has N different suggested alliances — set one". It is **edge-computed, never stored**
  (AR-6): recomputed on every render from the candidate rows; it **persists until one suggestion is chosen**
  for the group (the fan-out collapses the distinct set to 1 → flag clears). No `transfer_groups` read is
  needed (group id + suggested id are on the candidate rows).

### 14.1 The one new grant (`data.db`, not the schema snapshot)

On the **`transfer-curator`** policy add **whole-collection `transfer_groups` create / read / update /
delete** (`fields:["*"]`, no filter — the only free shape on Core). **`read` is required** (not optional):
`POST /items/transfer_groups` echoes the new id **only** with a read grant, and the linking flow needs it.
Everything else is already live: the **5.5** whole-collection `candidates` update grant covers `group` /
`suggested_alliance` writes; the **5.5** `alliances` read covers the suggested-alliance picker. The
`transfer-viewer` `transfer_groups` read is **re-deferred** (roles §3) — 5.6 derives its accents/flag/
summary from `candidates`, so a Viewer needs no `transfer_groups` read until group **names** are shown.
`app_access` is **not** needed (custom `/admin` shell, session REST API — §5).

### 14.2 Local verification status (Story 5.6)

Verified against real `directus/directus:12.0.2` (Core, `LICENSE_KEY=""`) on the Windows/Docker box
(disposable container `k1516-56verify` via PowerShell; committed `directus-schema.yaml` applied —
"Snapshot applied successfully" — then `docker restart` to reload the schema cache; torn down after).
A `transfer-curator` policy (candidates read+update, transfer_period read, alliances read, **transfer_groups
create/read/update/delete**) and a `transfer-viewer` policy (candidates/transfer_period/alliances read, **no
transfer_groups**) were minted and attached to roles; a Curator + Viewer user drove the proofs. **21/21:**

- **Grants** — all 8 Curator grants (incl. `transfer_groups` CRUD) created **200** (free whole-collection);
  the 3 Viewer grants **200** (no `transfer_groups`).
- **AC1** — Curator `POST /items/transfer_groups` → **200** and the response **echoes the new id** (the read
  grant makes the echo work → the linking flow gets its id). Curator batch `PATCH /items/candidates`
  `{keys:[c1,c2,c3], data:{group:gid}}` → **200**, all 3 stamped. Curator `DELETE /items/transfer_groups/:id`
  → **200** and the member's `candidates.group` went **`null`** (`on_delete: SET NULL` — the dissolve path).
- **AC3** — the group-level fan-out: **one** `PATCH /items/candidates` `{keys:[c1,c2,c3],
  data:{suggested_alliance:al1}}` set **all three** members to `al1` in a single request (`updateItems`).
- **AC4** — after setting one member to a different alliance, the group held **2 distinct** non-null
  suggested alliances (the divergent condition — the flag is edge-computed from exactly this); the "set one"
  fan-out then collapsed it to **1 distinct** (the flag clears). No stored flag, no `transfer_groups` read.
- **AC2** — a **Viewer** `POST`/`PATCH` on `transfer_groups` → **403**; **anonymous** `POST` → **403**;
  **Owner** (admin bypass) → **200**.
- **License wall (re-proven)** — creating a **field-subset** (`fields:["name"]`) and a **row-filter**
  (`permissions:{name:{_nnull:true}}`) grant on `transfer_groups` each → **403
  `RESOURCE_RESTRICTED`** ("custom_permission_rules_enabled is a restricted resource") — so whole-collection
  CRUD is the only free shape on Core (same §0 wall as candidates).
- **Build hygiene (Node 22)** — `dist/admin/index.html` links a stylesheet (CSS emitted — the Node-24 no-CSS
  hazard); the 5.6 logic (`Link group…`, `Set for whole group`, `different suggested alliances — set one`)
  and CSS classes (`cand-flag--divergent`, `cand-flag-chip`, `cand-linkpanel`, `cand-select`) are in the
  bundle; **zero** candidate data / session token baked into the static admin HTML.
- **Pure-logic unit test** — 26/26: `computeDivergentGroups` (≥2 distinct → divergent, nulls ignored,
  groups independent), the distinct-count, the fan-out member-id selection, `linkGroup` (create / join
  existing), `unlinkFromGroup` (dissolve at <2 members), and the fan-out collapsing divergence to 1.

## 15. Capacity counters, active-window scoping & carry-over (Story 5.7)

Per-path **planning counters** for the current transfer window, above the `/admin` Candidates table.
Everything here is a **pure edge computation over the single `getCandidates` fetch + the active period's
live caps** — **no stored counter, no `entry_route`, no `carry` field, no Directus Flow** (AR-6/AD-4/AD-7).
**No schema change, no new grant, no `data.db` change** — the `transfer_period` read grant was wired +
live-verified in **5.4/5.5**; 5.7 just adds its **consumer**.

- **One new code seam** — `getActivePeriod()` in `site/src/lib/directus.ts`: a **runtime, session-cookie**
  read (`readItems('transfer_period', { filter:{ active:{_eq:true} }, fields:['*'], limit:1, sort:['-id'] })`)
  on the **same** client as `getCandidates`. **Not** the build-time reader in `transfer-build.ts` (that uses
  the static SSG token for `/join`). Returns `null` when no window is active (0 rows) → the shell degrades
  calmly, it never throws at runtime.
- **Active-window scoping (AC-4)** — the table renders `candidateRows.filter(period === activeId || status
  === 'Accepted')`: the active period's rows plus any **Accepted carry-over** from a prior window (an
  Accepted row still occupies a slot — AD-17). One status per row, so the OR naturally de-dupes. Client-side
  over the single fetch (AD-4 "one fetch per shell load"); no pagination (kingdom scale, YAGNI).
- **Three counters (AC-1/AC-2)** over the active-window set, by `planned_path` only: **Invite** `n /
  invited_cap`, **Special** `n / special_cap` (**gold, live** off the row — **never a hardcoded 3**),
  **Random-ask** a **bare list count** with **no denominator** (AR-19 dropped the random counter; the 20
  random slots are out of scope). A muted **"Accepted · no path: N"** line shows only when N>0 (a raw-API-only
  occupied slot — the UI Accept forces a path). Over-target counts (e.g. `36 / 35`) render **plainly, no red,
  no alarm**.
- **Never a gate (AC-3, hard)** — the Accept/Transfer/Reject write path (`buildActions` / `allowedActions` /
  `writeCandidate`) is **capacity-blind**: a full counter never blocks a write. This is on the UX-DR-20
  **Banned** list. The strip renders for **both** roles (Viewer read-only, Curator in Work mode) — a read
  surface, not gated.
- **Carry-over (AC-5)** — an Accepted candidate whose immutable `period` stamp ≠ the active id gets a
  **success-tinted "Carry-over" badge** (success green, never danger/gold) and is **sorted first**. Derived,
  never stored; 5.7 never writes `period`.
- **Read-after-write (AC-4)** — counters + scope + sort ride the existing `rerenderCandidates()` recompute
  after **every** Curator write (status/path writes now recompute the whole table, like the 5.6 group
  writes). This satisfies AC-4/AD-4 **functionally** but does **not** do a literal network re-fetch (OQ-2,
  Sabo 2026-07-11) — an accepted correct-course at ≤2-Curator scale (mirrors the 5.2 dropped-date call);
  the 5.5 stale-load-once hazard stays deferred, unchanged.
- **Resilience** — a transient `getActivePeriod` failure **does not cache zeroed caps** (that would freeze
  every denominator at `n / 0` for the session — the 5.6 `ensureAlliances` lesson): it degrades to `null`,
  the cards show `n / —` with a calm note, counts still compute; a **401/403** routes to `/leader`.
- **Build hygiene (Node 22)** — `dist/admin/index.html` links a stylesheet (CSS emitted); the 5.7 logic
  (`activeWindowRows`, `Capacity counters`, `Carry-over`) + CSS (`cap-strip`, `cap-counter`,
  `badge-carryover`) are in the bundle; **zero** candidate/period data or session token baked into the static
  admin HTML (the strip is built client-side after the runtime read).
- **No live-Directus re-proof needed** — 5.7 wires no grant and no schema; the `transfer_period` runtime
  read it consumes was already live-verified against real `directus:12.0.2` in **5.4/5.5**. Correctness is
  covered by the **31/31 pure-logic unit test** (scoping, carry-over predicate, carried-first stable sort,
  `planned_path` buckets, live `special_cap` never 3, no random denominator, caps-failure → `—` never `n/0`,
  0-active → `null`, never-a-gate over-target computes calmly).

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

### Candidates, transfer_period & settings (Story 5.1) — verified against real `directus/directus:12.0.2` (Core tier)

Live raw-API proof on the Windows/Docker dev box (disposable `directus:12.0.2` container, `LICENSE_KEY=""`,
fresh DB on the container overlay FS, brought up **via PowerShell** to avoid the Git-Bash/MSYS
`SQLITE_CANTOPEN` path-mangling wall; container torn down after). The proof first `schema apply`ed the
committed `directus-schema.yaml` (recreating `alliances` — **"Snapshot applied successfully"**, proving it
replays), then built the four new collections via the raw API, then re-snapshotted:

- **AC1 — canonical `candidates` shape:** created with `id` (int auto PK) + the 12 core applicant fields
  (`character_name`, `player_id`, `kingdom_number`, `timezone`, `who_invited`, `why_leaving`,
  `team_player_kvk`, `others_transferring`, `day4_fcfs`, `needs_special_invite`, `what_you_seek`,
  `players_to_avoid`) + `status` + `planned_path` + **two SEPARATE M2O → `alliances`**
  (`desired_alliance`, `suggested_alliance`, both `ON DELETE SET NULL`) + `group` (M2O → `transfer_groups`,
  SET NULL) + `period` (M2O → `transfer_period`, `NO ACTION`). A test candidate set
  `desired_alliance = A` and `suggested_alliance = B` **independently** (A ≠ B round-tripped) — the two
  distinct-writer relations are real, not one shared field. `status` **defaulted to `Applied`** (create
  omitted it); `planned_path` null at create. ✅
- **AC2 — no dropped fields:** the `candidates` schema has **19 fields, none named `entry_route`** and
  **no** counter / `carry` / random-entries field (regex-checked). Counting is by `planned_path` only. ✅
- **AC3 — `transfer_period`:** multi-row (`singleton=false`), Owner-written `invited_cap` / `random_cap` /
  `special_cap` / `active`; the active row for **2026-07-19** = `35 / 20 / 2`, `active=true`. The
  available-special-count lives **only** on `special_cap` — no special-count field exists on the settings
  singleton or elsewhere. **No counter/tally field.** ✅
- **AC4 — `settings` singleton:** created with `singleton: true`; holds `special_invite_power_threshold`
  = **130000000** and `transfer_cadence_weeks` = **8** — kingdom-wide thresholds only, **no special
  count** (AD-11). Editable data (not code literals) → NFR-17 satisfied. ✅
- **AC5 — `period` stamped-on-create:** `candidates.period` is a **required** (`is_nullable: false`) M2O to
  `transfer_period`, stamped to the **active** period (id 1) at create. The *shape* supports "stamped
  once." **Immutability is not server-enforceable on Core** (Option-3): a re-stamp `PATCH` of
  `period` (1 → a 2nd inactive period) returned **200** — recorded honestly as the documented limit
  (§10.6); it is a **silent** carry-over corruption vector under a future Curator full-update grant, logged
  as the decision-needed AD-17 item in `deferred-work.md`. ✅
- **⛔ License gate re-proven on `candidates` (confirms the distinct-writer + immutability enforcement is
  genuinely 🔒):** on the Core tier, creating a **field-subset** update grant
  (`["status","planned_path","suggested_alliance","group"]` — the AD-8/AD-9 Curator work-field limit; the
  **same field-exclusion is also the lever that would make `period` immutable**, by leaving it out of the
  writable set), a **custom validation** rule (probed with a `period` `_nnull` — a *representative* custom
  validation, **not itself an immutability rule**: `_nnull` only enforces presence, already covered by
  `is_nullable: false`; a real immutability guard would compare to the stored value, likewise a custom
  rule), and a **row filter** each returned **`403 RESOURCE_RESTRICTED`**
  (`custom_permission_rules_enabled is a restricted resource`); a **full-collection read** `fields:["*"]`
  returned **200**. So every finer rule is licensed — the distinct-writer field subset *and* the
  `period`-immutability lever (field exclusion, or a real immutability validation) — and the Option-3
  conventions (§10.6) are the only free path until Directus is licensed. ✅
- **Snapshot fidelity:** after building the collections, `directus schema snapshot` wrote the regenerated
  `infra/directus-schema.yaml` (now 5 collections — `alliances` + `candidates` + `settings` +
  `transfer_groups` + `transfer_period`); `directus schema apply --dry-run` on it → **"No changes to
  apply."** The committed snapshot is a faithful, replayable capture. ✅

The **production** collections are created on the host per §10 (or `schema apply infra/directus-schema.yaml`)
and captured by the daily `data.db` backup — the local DB used for this proof is throwaway. **ZERO `site/`
change**; `infra/directus-schema.yaml` **is** updated (the data model, unlike permissions, lives in the
snapshot — §6). No permission grants were wired (deferred to 5.2/5.4/5.5/5.6/5.8 — §10.6).

### Public transfer form + create-only grant (Story 5.2) — verified against real `directus/directus:12.0.2` (Core tier)

Live raw-API + build proof on the Windows/Docker dev box (disposable `directus:12.0.2` container,
`LICENSE_KEY=""`, fresh overlay-FS DB, **via PowerShell**; production rate-limiter values
`RATE_LIMITER_POINTS=50/DURATION=1`; torn down after). The committed `directus-schema.yaml` was
`schema apply`ed (all 5 collections — **"Snapshot applied successfully"**; note: a CLI apply needs a
**container restart** to reload the server schema cache — §6), then seeded (2 alliances; one active
`transfer_period` id 1 = `2026-07-19`; the `settings` thresholds), then the grants + `meta.required` wired
via the API.

- **AC1 — anonymous create-only POST:** an **unauthenticated** `POST /items/candidates` with the full form
  body → **HTTP 204** (create-only-no-read returns an empty body — the client treats any 2xx as success, no
  custom backend). Read back (admin): **`status = "Applied"`** (schema default — the client omits `status`),
  **`period = 1`** (the build-baked active period, stamped once — AD-17), **`desired_alliance = 1`**
  (resolved slug→id), and **`suggested_alliance` / `group` / `planned_path` all null** (Curator-only,
  correctly never sent — AD-8/AD-9). ✅
- **AC1 — no read (write-only):** an **unauthenticated `GET /items/candidates` → 403.** The Public grant is
  `create` only; deny-by-default keeps the collection unreadable to the public (AD-12). ✅
- **AC2 / AC3 — fields + Player ID:** the built `/join` renders the **13 fields** (10 required / 3 optional)
  + the honeypot; **`player_id` is required and stored** as the in-game contact key (round-tripped as
  `900123456` above). Required-field UX is client-side; the **`meta.required` backstop** returns a clean
  server **400 `FAILED_VALIDATION` — "Value is required"** when a required **default-null** field is omitted
  (not a raw DB NOT-NULL error) — resolving the 5.1-review deferred item. *(The four defaulted fields —
  `status` + the three booleans — are satisfied by their DB default on omission, not 400'd; see §11.3.)* ✅
- **AC4 — confirmation:** the built `/join/index.html` contains the confirmation climax copy **"You're set.
  A leader will reach you in-game via your Player ID before the next transfer window."** *(The 5.2 code
  review dropped the hard-coded "19 July" date — a static-site display value can't self-refresh without a
  rebuild, and the Owner declined maintaining it; the "name the exact window live" option is a separate
  correct-course. See the review findings in the 5.2 story.)* ✅
- **AC5 — abuse floor:** the **Directus IP rate limiter** honored the `RATE_LIMITER_*` env — a burst of 9
  requests under a demo `POINTS=5/DURATION=60` limit returned `200 200 200 200 200` then **`429`** for the
  rest (production uses 50/1). The **honeypot** decoy ships hidden in the form; a filled decoy is silently
  dropped client-side before any POST. No captcha (deferred, AD-12). ✅
- **AC6 — inline validation:** the form validates all 10 required fields client-side with per-field,
  plain-language `role="alert"` messages (never the raw Directus envelope); the `meta.required` 400 is the
  server backstop (above). ✅
- **⛔ License gate re-proven (why the hardening is at the edge, not in the grant):** adding a **field
  subset** OR a **validation rule** to the Public `candidates` grant each returned **`403
  RESOURCE_RESTRICTED`** (`custom_permission_rules_enabled is a restricted resource`); the free
  whole-collection `create` (`fields:["*"]`, `permissions:{}`) was accepted (**200**). So a `preset` forcing
  `period`/`status` or a field-lock is 🔒 licensed — the client-sends-`period` + `status`-default +
  honeypot/rate-limiter edge approach is the only free path (Option 3, §11 / roles-and-policies §4). ✅
- **Build-time reads (AC1 prerequisites):** the `finder-build-read` token reads **`alliances` {id,slug,name}
  → 200** (2 rows) and **`transfer_period` active → 200** (id 1); an **anonymous** `alliances` read → **403**
  (Public stays locked). A Node-22 `astro build` against the live Directus baked
  `activePeriodId: 1` + `slugToId: {"516":2,"frostborne":1}` into `/join`, emitted CSS (`rel="stylesheet"`
  present — the Node-22 no-CSS hazard check), and **leaked no token** into `dist/`. ✅
- **Snapshot fidelity:** `directus schema snapshot` after the `meta.required` edit produced a **clean 12-line
  diff** vs the committed `directus-schema.yaml` (the 12 NOT-NULL `candidates` fields flipped
  `required: false → true`), no drift; committed. ✅

The **production** Public create-only grant + the `finder-build-read` `transfer_period` read live only in
`data.db` (Studio-authored, daily backup — §3), not the schema snapshot; the `RATE_LIMITER_*` env is in
`docker-compose.yml`; `meta.required` is captured in `directus-schema.yaml`. The `/join` form + the two new
build seams live in `site/` (the first Epic-5 `site/` change — AR-3's permitted apply-step swap). Local DB
throwaway.

### Special-invite flag — power > threshold (Story 5.3) — verified against real `directus/directus:12.0.2` (Core tier)

Live raw-API + build proof on the Windows/Docker dev box (disposable `directus:12.0.2` container
`k1516-53verify`, `LICENSE_KEY=""`, fresh overlay-FS DB, **via PowerShell**; torn down after). The committed
`directus-schema.yaml` was `schema apply`ed (all 5 collections — restart to reload the cache), then seeded
(1 alliance; one active `transfer_period` id 1; `settings.special_invite_power_threshold = 130000000`), then
the Public create + `finder-build-read` reads (`alliances` + `transfer_period` + **`settings`**) wired via
the API.

- **AC2 — grant + read (the new `settings` read):** the `finder-build-read` **static token**
  `GET /items/settings` → **200**, `special_invite_power_threshold = 130000000`; it also reads `alliances`
  (1 row) + the active `transfer_period` (id 1). An **anonymous** `GET /items/settings` → **403** — Public
  stays locked, the threshold is never publicly readable (AD-12). ✅
- **AC2 — editable config, not a literal:** a Node-22 live build baked
  **`specialInvitePowerThreshold: 130000000`** into `/join`'s `apply-config` JSON; **changing the singleton
  to `140000000` + rebuilding** baked **`140000000`** (the badge names the live value — never hardcoded). ✅
- **AC1 — the flag is recorded from the derived boolean:** an **anonymous** `POST /items/candidates` with
  `needs_special_invite: true` (power > limit) and a second with `false` (≤ limit) each → **2xx**; read back
  (admin): row #1 `= true`, row #2 `= false`, both `status = Applied` (default), `period = 1`, and
  `suggested_alliance`/`group`/`planned_path` **null** (Curator-only, never sent). Anon `GET /items/candidates`
  → **403** (create-only, no read). ✅
- **AC1 — compare semantics (client, deterministic):** a faithful replica of the shipped `powerToRaw` +
  `needsSpecialInvite` derivation asserts **12/12**: at `threshold = 130M`, power `145`→flag, `120`→no,
  **exactly `130`→no** (strict `>`), `130.5`→flag, `129.999`→no, empty/`abc`/`-5`/`0`→no; at
  `threshold = null`/`0` **every** input → no flag (the D3 client guard — never `power > null`). Power is
  entered **in millions** (×1,000,000 before the compare) and is **never sent or stored** (no `power`
  column). ✅
- **D3 — null threshold fails the build LOUD:** setting the singleton threshold **null** and rebuilding
  **failed the Node-22 build (exit 1)** with `Error: settings.special_invite_power_threshold is not a
  positive number (got null)…` — a broken classifier never ships (contrast the pre-5.3 fail-silent
  `power > null`). Restored to `130000000` after. ✅
- **⛔ License gate re-proven for `settings`:** adding a **field-subset** read
  (`fields: ['special_invite_power_threshold']`) to a policy → **403 `RESOURCE_RESTRICTED`**
  (`custom_permission_rules_enabled is a restricted resource`); only the **whole-collection** read
  (`fields: ['*']`) is free on Core — the shape the `finder-build-read` grant uses. ✅
- **Build hygiene:** the final Node-22 live build emitted **CSS** (`rel="stylesheet"` present — the Node-24
  no-CSS hazard check), **leaked no token** into `dist/`, rendered the **power input** (`type=number`,
  `inputmode=decimal`, `required`) + the `badge-special` (`role="status"`, `triangle-alert` icon, hidden
  until over the limit), and the old self-declared `needs_special_invite` Yes/No is **gone**. A **seed-mode**
  build (no token) is green with `specialInvitePowerThreshold: null` (badge inert, form can't POST — expected
  pre-launch). ✅

The **production** `finder-build-read` `settings` read grant lives only in `data.db` (Studio-authored, daily
backup — §3), **not** the schema snapshot; **no `directus-schema.yaml` change** in 5.3 (the `settings`
collection + field already exist from 5.1). The power input + threshold-derivation live in `site/`
(`join.astro` + `transfer-build.ts`). Local DB throwaway; `k1516db`/`k1516vdb` left for the Owner to prune.
