# Live-Cutover Checklist — Kingdom 1516

Aggregated from the 2026-07-17 pre-cutover audit (9 audit areas, all epics). Every item
here is **live-only**: it cannot be proven from the repo and must be performed/verified
on the real VPS + Directus + GitHub. Order matters top-to-bottom. Detailed commands live
in `infra/README.md` (§ references below).

## Phase 0 — Prerequisites

- [ ] Procure the real domain; decide apex (`SITE_DOMAIN`) + admin subdomain (`DIRECTUS_DOMAIN`).
- [ ] Create the dedicated Vultr VPS (isolated, not co-hosted with the Discord-bot box).
- [ ] DNS A/AAAA for BOTH domains → VPS **before** first public `docker compose up`
      (Caddy must not burn ACME attempts against `.example` placeholders).
- [ ] ⭐ **Seat-cap decision (README §19.4):** Directus Core refuses the 4th `app_access` user
      (403 seats LIMIT_EXCEEDED). Decide before onboarding ~10 leaders: transfer roles
      API-only (`app_access:false`), cap Editor/Senior/Official Studio accounts, or license.

## Phase 1 — Host provisioning (README §1)

- [ ] Install docker, sqlite3, rclone, rsync; add 1–2 GB swap (persist in `/etc/fstab`).
- [ ] `mkdir -p /srv/site`, owned by the deploy user.
- [ ] `cp .env.example .env`: strong `SECRET` (`openssl rand -hex 32`, then NEVER rotate),
      real `ADMIN_EMAIL`/`ADMIN_PASSWORD`, real domains, `PUBLIC_URL` (trailing slash).

## Phase 2 — First boot (README §2)

- [ ] `docker compose up -d` → caddy + directus **Up**, caddy-init **Exited (0)**.
- [ ] `docker compose ps`: ONLY Caddy publishes 80/443; Directus port 8055 NOT host-reachable.
- [ ] Auto-HTTPS: valid certs on apex + admin subdomain; HTTP→HTTPS redirect works.
- [ ] Security headers present on both hosts (HSTS, nosniff, X-Frame-Options, Referrer-Policy
      — added 2026-07-17; `curl -sI https://<domain> | grep -i strict`).
- [ ] Log in to Studio, change the admin password, REMOVE `ADMIN_PASSWORD` from `.env`, re-up.
- [ ] Apply the committed schema snapshot; then **re-apply `storage_asset_transform: none`**
      (lives in data.db, reverts to `all` on a from-scratch apply — README §18.3).

## Phase 3 — Roles, grants, seeds (all data.db — NOTHING here is in git)

- [ ] Roles/policies per `roles-and-policies.md`: base Leader role, 6 per-area policies,
      Public = no permissions, Owner = Administrator; correct `app_access` per Phase-0 decision.
- [ ] Mint every grant: alliances-official read+update; candidates Public **create-only, no read**
      + transfer-viewer read + transfer-curator update/delete + transfer_groups CRUD;
      guides-editor (guide_drafts create/update + reads); guides-senior (guides create/update,
      guide_drafts update); finder-build-read (alliances, transfer stack, guides, categories,
      directus_files — read-only).
- [ ] Seed the 5 alliance rows via **JSON import** (never CSV — it numeric-coerces slug '516');
      then assign each row's `official` M2O (Osmo/Ritter/Liam1/NellyWonka/Nevada mapping).
- [ ] Confirm 3 starter categories exist: `events` / `troops-heroes` / `alliance-transfer` (sort 1/2/3).
- [ ] Author EXACTLY ONE `transfer_period` with `active=true`, incl. `invited_cap`/`special_cap`,
      `starts_on` (date) and the year in the name (convention: `July 2026 transfer window`).
- [ ] Author the `settings` singleton: `special_invite_power_threshold` in RAW units
      (**130000000**, not 130 — a units mis-entry passes the sign guard and flags everyone).
- [ ] Re-apply the `alliances.slug` "lock after creation" Studio condition (not in the snapshot).

## Phase 4 — Boundary matrix (prove the gates live)

- [ ] Anon: POST /items/candidates → 2xx (status defaults 'Applied'); GET candidates → 403.
- [ ] transfer-viewer: read 200 (deep alliance expand), writes 403.
- [ ] transfer-curator: PATCH status/path/group 200, DELETE 204, batch ops 2xx.
- [ ] guides-editor: guide_drafts create/update 200; **guides create/update 403** (the publish gate).
- [ ] guides-senior: guides create/update 200; Viewer draft-read 200, writes 403.
- [ ] Non-Owner: POST /users 403, PATCH other users 403; Owner 200.
- [ ] Anon GET alliances/guides/categories → 403; build token → 200; build token has NO
      directus_users read (no leader PII into static HTML).
- [ ] `/assets/<id>` → 200 original; `?width=100` → 400 (transforms off); token-less asset GET 403.
- [ ] Rate limiter throttles a single-IP burst >50 req/s on /items/candidates.
- [ ] Leader-login smoke (README §2.3): HttpOnly+Secure+Lax cookie on `.<domain>`,
      localStorage/sessionStorage EMPTY, logout clears, /leader→/admin handoff works.

## Phase 5 — CI, build token, deploy

- [ ] Mint the finder-build static token → GitHub secret `DIRECTUS_TOKEN`;
      repo variable `PUBLIC_DIRECTUS_URL` = live admin subdomain (mismatch silently breaks login).
- [ ] Set deploy secrets: `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `DEPLOY_PATH=/srv/site`.
- [ ] Trigger a build: runs on Node 22 (`.nvmrc`), "Verify CSS emitted" passes, rsync lands in
      `/srv/site`, site serves styled over HTTPS.
- [ ] **Configured-build gates on the deployed dist:** zero `access_token=`/token strings; Finder
      shows live Directus data ("Sourced N alliance(s)"); /guides renders published guides; every
      guide image is a local hashed asset (zero Directus-origin URLs); a draft-only row appears
      NOWHERE in dist; guide-image width cap ≤1200 applied.
- [ ] Run the committed E2E suite against the deployed build once (`cd site && npm test` with
      baseURL pointed at the live host, or locally against a configured build).

## Phase 6 — Rebuild Flows (Directus → GitHub)

- [ ] Author BOTH Flows (Event Hook, non-blocking): alliances (§9.5) and guides+categories
      (§19.3, NEVER guide_drafts). **Swap the request URL from the SSRF-blocked localhost used in
      container verification to** `https://api.github.com/repos/<owner>/<repo>/dispatches`,
      body `{"event_type":"directus-publish"}`, fine-grained PAT as a Directus secret (never git).
- [ ] Fire each once end-to-end: edit → Flow → repository_dispatch → build → rsync (~1–3 min).
- [ ] Confirm these are the ONLY custom Flows on the instance (AD-7).
- [ ] Flip of active period / threshold → rebuild fires (both are build-baked into /join).

## Phase 7 — Backup & host hygiene

- [ ] Configure the rclone R2 remote (never commit rclone.conf); schedule `backup.sh` daily cron.
- [ ] ⭐ **Run backup.sh once BY HAND** and confirm dated artifacts in R2 — this was the
      silently-broken volume-name path fixed 2026-07-17; the volumes must resolve as
      `directus_db`/`directus_uploads` (now pinned via compose `name:`).
- [ ] Confirm the first-run retention prune tolerates not-yet-existing daily/weekly prefixes.
- [ ] **Restore-test once**: data.db backup → fresh instance → roles/policies/grants recover
      (the schema snapshot excludes them; the backup is the ONLY carrier).
- [ ] Schedule weekly `docker system prune -af` cron.
- [ ] Mute/trim `/assets` query-string logging at the proxy (build token rides `?access_token=`);
      document a rotation cadence for the build token + Flow PAT (§9.5 covers minting only).

## Phase 8 — Public-surface smoke (live host)

- [ ] With Directus STOPPED: Home, /tools, calculator render fully (zero runtime backend dependency).
- [ ] No requests to fonts.googleapis.com / gstatic (self-hosted fonts).
- [ ] Calculator vs legacy oracle spot-check on live (the committed parity suite covers this too).
- [ ] Headed light/dark pass over all surfaces (the dark-mode wash-out guard is structural only —
      no human eyeball pass has ever run).
- [ ] Finder: timezone detect, re-rank on change, peak-window add/remove, no-good-match banner.
- [ ] Join → submit a real test candidate end-to-end; it lands as 'Applied'; delete it via the shell.
- [ ] Legacy root `index.html` keeps serving on GitHub Pages until cutover is declared done —
      Pages source must NOT switch to "GitHub Actions".

## Accepted residuals (verified, consciously carried — do not re-litigate at cutover)

- Option-3: a raw-API poster can set privileged candidate fields (status/period) — trusted-≤2-Curator
  + daily backup is the mitigation; revisit only if abuse appears.
- Slug immutability + period no-re-stamp are copy-discipline, not server rules (Core license wall).
- Build token appears in own-infra access logs via `?access_token=` (mitigated Phase 7).
- Foreign-origin guide images pass through un-localized (ratified hotlink stance).
- Muted-text contrast < WCAG AA on small hints/labels (a11y ambition is "Minimal"; darkening
  `--color-muted` would clear AA — brand-taste decision, not a launch gate).
