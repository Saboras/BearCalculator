# Roles, policies & permissions — the Kingdom 1516 authorization contract

**Status:** canonical, version-controlled security contract (Story 3.3).
**Scope:** the Directus **role / policy / permission MODEL** every MVP-2 admin surface
inherits — Candidates pipeline (Epic 5), Alliances row-editing (Epic 4), Guides publish
gate (Epic 6), Accounts (Story 3.4 — **delivered**: the account-lifecycle runbook now lives in
[`README.md` §8](README.md)). This document is the **source of truth**; the running
Directus config is applied from it in the Data Studio (see `README.md` §7). The per-collection
grants attach to these same policies **as each collection lands** (Epics 4–6) — this file
lists every one of them with the story that wires it.

> **Why a document and not a script.** Roles/policies/permissions live **only** in
> `data.db` (SQLite) — Directus's `schema snapshot` captures `collections`/`fields`/
> `relations` **only**, never permissions (verified — see §7). There is no first-class
> permissions export. So the durable, reviewable source of truth is this file; the running
> state is authored in the Data Studio (AD-3) and recovered from the Story 3.1 daily backup.
> No bootstrap script (YAGNI + AD-3 — see §7).

---

## ⚠️ 0. Directus 12 licensing constraint — READ FIRST (verified 2026-07-01)

The most important operational fact about this model, discovered during the Story 3.3 local
verification against the pinned **`directus/directus:12.0.2`** image and confirmed against
Directus's own v12 breaking-changes docs:

> **Directus 12 actively enforces licensing. Self-hosted instances default to the *Core* tier.
> "Custom permission rules on access policies" are a *licensed* feature — they do not work on
> the unlicensed Core tier. New instances face *immediate* enforcement (no grace period);
> instances upgraded to 12 get a 30-day grace window.**
> [Source: Directus docs — *Version 12.0.0 › License Enforcement* / breaking-changes/version-12; ctx7 `/directus/docs`, 2026-07-01.]

**"Custom permission rules"** = any permission whose rule is more granular than
all-or-nothing for a whole collection: an **item/row filter** (`permissions`, where
`$CURRENT_USER` lives), a **field-level** restriction (a `fields` subset), a **validation**
rule, or **presets**. Verified locally — every one of these returns
**HTTP 403 `RESOURCE_RESTRICTED`** (`custom_permission_rules_enabled is a restricted
resource`) when created on the Core tier (see the proof table below and `README.md` §7).

### What this means for THIS model

| Mechanism this model relies on | Directus feature | Core tier (unlicensed) |
|---|---|---|
| Deny-by-default (no grant → 403) | base access model | ✅ **free** — proven |
| **Collection-level CRUDS** grant (full create/read/update/delete/share per collection) | base RBAC | ✅ **free** — proven |
| Owner = `admin_access` universal bypass | base access model | ✅ **free** — proven |
| Public = no access baseline | base access model | ✅ **free** — proven |
| **AD-5 — Alliance Official own-row** (`official = $CURRENT_USER` item filter) | custom permission rule (item) | ⛔ **licensed** |
| **AD-6 — Guides publish gate** — **resolved via Option 2** (split `guide_drafts`/`guides` collections, Story 6.1); the *original* `status` field-gate form | collection-level split (Opt 2) — the original field subset | ✅ **free — server-enforced** (Opt 2, live-proven 6.1) / ⛔ licensed (the field-gate form) |
| Curator writes *only* work-fields on `candidates` (field subset) | custom permission rule (field) | ⛔ **licensed** |
| Any field validation / presets on a permission | custom permission rule | ⛔ **licensed** |

So the model's **collection-granularity** half (Viewer *cannot* write, Curator *can* — as
whole-collection grants; Owner override; Public lock) is enforceable **now, for free**. Its
**mechanism** is **proven** on the collections that exist today — the *system* collections
(`directus_users` / `_roles` / `_policies`), 20/20 checks including the license-gate probes. The
**domain-collection** 403s (Viewer-on-`candidates`, etc.) are **deferred** — provable only once
those collections land (Epics 4–6): the mechanism is proven, the domain target is not yet
exercised. The model's **within-collection** half — **row-scoping** (AD-5) and **field-scoping**
(AD-6, and the Curator's field-limited candidate writes) — **requires a paid Directus license**
on this pinned image.

### Owner decision — RATIFIED 2026-07-01: **Option 3 (accept collection-level enforcement)**

> **DECIDED (Sabo, Owner, 2026-07-01): Option 3.** No Directus license, no re-architecture. The
> model is enforced at **collection granularity** (free, proven); the finer **row-** (AD-5,
> Alliance Official own-row) and **field-** (AD-6, Guides publish gate) boundaries become
> **UX-guided conventions among trusted leaders — explicitly NOT server-enforced.** This is a
> conscious, documented softening of AD-4/AD-5/AD-6 for the ~10-trusted-admin hobby scope:
> the threat model is small (known leaders, not anonymous public), an accidental cross-row edit
> is reparable and caught by the daily backup, and KISS/YAGNI favour not paying/rebuilding for a
> hard server riegel here. **Revisitable:** if the kingdom grows or trust assumptions change,
> upgrade to Option 1 (license) — the spec below stays valid, only the 🔒 rules flip from
> "collection grant + UX guard" to "real row/field permission." See "What Option 3 means
> concretely" below and §4 (mechanisms 1 & 2).

**What Option 3 means concretely (how the 🔒 rules are actually implemented):**

| 🔒 Rule (as designed) | Under Option 3 (implemented) | Server-enforced? |
|---|---|---|
| AD-5 — Alliance Official edits **own row only** (`official = $CURRENT_USER`) | All Officials share a **full-collection `alliances` update** grant; own-row is enforced **only by Owner discipline in the Data Studio** (Alliances CRUD is Data-Studio-only, AD-3 — each Official edits just their row by convention). | ❌ no — UX-guided; a direct API call could touch another row |
| AD-6 — **only Senior** may publish (~~`status` field-gate~~ → **Option 2**, Story 6.1) | **Split collections:** Editor writes `guide_drafts` only (**no** grant on `guides`); Senior/Owner writes `guides`. Publishing = a Senior copies a draft into `guides` (same slug). | ✅ **YES — server-enforced & free** (an Editor gets a real **403** on `guides`; live-proven Story 6.1 — the one Option-2 exception to the Option-3 softening) |
| Curator writes **only** work-fields on `candidates` (field subset) | Curator gets a **full-collection `candidates` update** grant; the "don't touch the public core / `desired_alliance`" boundary (AD-8/AD-9) is a **UX + convention** guard. | ❌ no — UX-guided |

The **collection boundaries stay server-enforced** (proven): a Transfer/Guides **Viewer** has
**no** write grant → **403** on any write (AC3); the **Owner** overrides (AC4); **Public** is
locked. So "a Viewer can never do a Work action" holds at the server; what is *not* server-held
under Option 3 is the *within-a-writer-role* fineness (which row / which field).

> ### Amendment — RATIFIED 2026-07-14: **Option 2 for the Guides publish gate (AD-6 only)**
> **DECIDED (Sabo, Owner, 2026-07-14): the Guides publish gate uses Option 2 (split collections), not Option 3.** Unlike the Alliance-Official own-row and Curator work-fields boundaries (which stay Option-3 UX conventions), the guides gate controls **public visibility**, so it is worth hard-enforcing — and Option 2 does so **for free** on Core. **AD-6 is amended** from "field-level `status` permission" to: **two collections** — `guide_drafts` (Editor-writable) and `guides` (Senior/Owner-writable, the public-build source). Draft-vs-published is **collection membership** (no `status` field). Because `guides-editor` holds **no write grant on `guides`**, an Editor's publish attempt is a **genuine server-side 403** — collection-level, license-free, live-proven in Story 6.1. The collections + free reads land in **6.1**; the Editor `guide_drafts` write in **6.2**; the Senior `guides` write (the publish action) + the draft→published **copy mechanism** in **6.3** (which must **not** be a custom approval Flow — AD-6/AD-7). Slug immutability stays a free Studio `readonly` condition + discipline (still 🔒 to server-enforce). *(This resolves the deferred-work "6.1 publish gate unsatisfiable as worded" item — it is now satisfiable and satisfied. 6.3 delivered: the Senior writes are wired + live-proven, and the copy mechanism is the admin-shell publish panel — README §19.)*

> ### ⚠️ Second license wall — RECORDED 2026-07-16 (Story 6.3): **Core caps Studio-user SEATS**
> On a fresh `12.0.2` Core container, creating the **4th** user whose policy union carries
> **`app_access: true`** fails server-side with `403 {"category":"seats","code":"LIMIT_EXCEEDED"}` —
> the free tier limits **"Studio Users"** (Directus docs: Admin *or* App access in ≥1 policy; an
> over-entitlement instance can even be **locked down** after a grace period). Users **without**
> `app_access` are unlimited — and the custom admin shell + public site authenticate via the
> **session API**, which needs **no seat**. Consequence for the §2 taxonomy: `app_access: yes` is a
> **scarce resource** — only leaders who genuinely open the Data Studio need it (Guides
> Editors/Seniors for WYSIWYG authoring, the Owner, Alliance Officials for their row); Transfer
> Curators/Viewers work entirely in the custom shell and can run `app_access: false`. Weigh before
> onboarding ~10 leaders: trim `app_access` per policy, cap simultaneous Editor accounts, or license.
> Tracked as a decision-needed item in `deferred-work.md`; README §19.4 carries the full finding.

<details><summary>The two options NOT taken (kept for the record / future revisit)</summary>

Before Epic 4.2 (Official own-row) and Epic 6 (publish gate), the alternatives were:

1. **License Directus** — buy the tier that unlocks custom permission rules, then AD-5/AD-6
   work verbatim as specified below. *(Verify current Directus commercial terms and whether a
   non-commercial/hobby license covers this — their pricing changes; do not assume.)* **Keeps
   the architecture unchanged.**
2. **Re-architect the granular parts to collection granularity** (a correct-course / AD-5 &
   AD-6 amendment, not a dev-story change):
   - *Alliance Official own-row* → e.g. Officials share a full-collection `alliances` write
     grant and own-row-only is **UX-guided, not server-enforced** — which **contradicts AD-5**
     ("every restriction is a permission, not a UI affordance"), or the Owner/Curator edits
     alliances instead of per-alliance Officials.
   - *Guides publish gate* → split drafts vs published into **two collections**
     (`guide_drafts` Editor-writable, `guides` Senior-writable) so the boundary is
     collection-level (free) instead of a `status` field-gate — an **AD-6 amendment**.
     **← CHOSEN for Guides (Sabo, 2026-07-14; see the Amendment above). Implemented Story 6.1.**
3. **Accept reduced enforcement for the hobby scope** — collection-level only, row/field as
   trusted-leader conventions. **← CHOSEN (see above).**

Option 1 remains the clean upgrade path if trust assumptions ever change; Option 2 (e.g. split
Guides `drafts`/`published` into two collections) is available if a *specific* boundary later
needs hard server enforcement without licensing everything.

</details>

**Proof captured 2026-07-01** (`directus/directus:12.0.2`, Core tier, raw API):

| Attempted permission shape | Result |
|---|---|
| Row filter `{ "id": { "_eq": "$CURRENT_USER" } }` | `403 RESOURCE_RESTRICTED` 🔒 |
| Field subset `fields: ["name"]` | `403 RESOURCE_RESTRICTED` 🔒 |
| `validation: { name: { _nnull: true } }` | `403 RESOURCE_RESTRICTED` 🔒 |
| Full grant `permissions: {}`, `fields: ["*"]` | `200` ✅ free |

---

## 1. The Directus 12 access model (self-contained)

Directus 11+ (we run **12.0.2**, AR-2) replaced "one role = one permission set" with a
three-layer model joined by `directus_access`:

- **Role** (`directus_roles`) — a named group of users; mostly a *container* now. The Owner
  maps to the built-in **Administrator** role.
- **Policy** (`directus_policies`) — carries the actual **permission rules** *plus* the flags
  **`admin_access`** (full bypass — Owner only), **`app_access`** (may load the Data Studio),
  `enforce_tfa`, `ip_access`. A policy attaches to **roles *or* directly to users** via
  `directus_access`.
- **Permission** (`directus_permissions`) — one **(collection, action)** rule with:
  - `fields` — field-level scope (🔒 licensed if a subset; `["*"]` is free),
  - `permissions` — the **row filter** (🔒 licensed if non-empty; this is where
    `$CURRENT_USER` / `$CURRENT_ROLE` / `$CURRENT_POLICIES` live),
  - `validation` (🔒 licensed if non-empty), `presets` (🔒 licensed if non-empty).
- **Additive / union semantics** — a user's effective access is the **union** of every policy
  they hold. **Model by *granting*; never try to "deny" — absence of a grant *is* the deny**
  (deny-by-default, verified). This is *why* the per-area model works: a leader is the base
  **Leader** role + `transfer-viewer` + `guides-editor` (two policies) → the union is exactly
  "read Transfer, edit Guides drafts."
- **`/permissions/me`** — returns the current user's per-collection access
  (`none` / `partial` / `full`); the endpoint the Story 3.5 shell reads for the role chip and
  to hide inaccessible tabs. (Seam only — not built here; verified reachable, Story 3.3.)

---

## 2. Role / policy taxonomy (AC1 — roles are per-area, combined per leader)

Roles are **independent per area and combine per user**, so the model is **one policy per
(area, level)** attached to a leader **in combination** on a base **Leader** role — *not* one
monolithic role. A leader can be Viewer-in-Transfer **and** Editor-in-Guides simultaneously
(two policies). The four governed areas are independent: **Transfer, Guides, Alliances,
Accounts**.

| Area | Policy / role | `app_access` | Grants (primary writer per AD-9) | Enforcement mechanism |
|---|---|---|---|---|
| — (base) | **Leader** (role) | — | login + read-own-profile; the container every leader shares | base role |
| Transfer | `transfer-viewer` | ⏳ see §5 | **read** `candidates` + `transfer_period` (+ `alliances` for M2O names) — no writes; `transfer_groups` read ⏳ (re-deferred at 5.6 — not needed until group **names** are shown; §3) | collection **read** grant ✅ free — **candidate list delivered Story 5.4** |
| Transfer | `transfer-curator` | **no** (API-only — the custom `/admin` shell uses the session REST API, not the Data Studio; §5) | Viewer reads **+ update** `candidates` (whole-collection, Option 3): status / planned_path (**5.5**), suggested_alliance / group (**5.6** ✅); its own `transfer_period` + `alliances` reads (**5.5**); `transfer_groups` **CRUD** (**5.6** ✅); delete ✅ **5.8** | collection **read + update + delete** grant ✅ free — update delivered **5.5**, grouping delivered **5.6**, delete/cleanup delivered **5.8**; *field-limited to work-fields* is the 🔒 Option-1 target |
| Guides | `guides-viewer` | yes | **read** `guide_drafts` + `guides` + `categories` (leader-visible drafts + published) — **wired Story 6.1** | collection **read** grant ✅ free |
| Guides | `guides-editor` | yes | create/update `guide_drafts` (whole-collection); read `categories` — **no grant on `guides`** so cannot publish | collection **write** on `guide_drafts` ✅ free — **Option 2** (6.1 shape; write grant **wired Story 6.2**, live-proven) |
| Guides | `guides-senior` | yes (for *authoring* via `guides-editor`; the **publish surface itself is the custom `/admin` shell** — session API, no seat needed; §0 seats note) | **publish**: create/update `guides` (the publish action) **+ update `guide_drafts`** (re-edit before re-publish); reads `guide_drafts` + `guides` + `categories` wired 6.1 — the Senior *role* also holds `guides-editor` to author drafts | collection **write** on `guides` ✅ free — **Option 2**, server-enforced gate, **wired Story 6.3** (live-proven: Senior 200, Editor/Viewer 403) |
| Alliances | `alliances-official` | yes | **read + update `alliances`** — as-built (Option 3): `fields:["*"]`, no row filter; own-row + own-fields are Owner discipline | collection **read + update** grant ✅ free — **delivered Story 4.2**; the own-row `official = $CURRENT_USER` filter + field subset (AD-5) is the 🔒 Option-1 target |
| Alliances / Transfer / Guides | `finder-build-read` (service) | no | **read `alliances`** (Story 4.3) **+ read `transfer_period`** (Story 5.2 — the active period id the `/join` form stamps into `candidates.period`) **+ read `settings`** (Story 5.3 — the `special_invite_power_threshold` the `/join` power-badge compares against) **+ read `guides` + `categories` + `directus_files`** (Story 6.4 — the public KB build source + guide-image originals; NEVER `guide_drafts`); the SSG build token; no write, no other collection | collection **read** grants ✅ free — **delivered 4.3 / 5.2 / 5.3 / 6.4** (keeps Public locked; §3) |
| all | **Owner** = built-in **Administrator** role (`admin_access: true`) | — | **everything** (universal override) | admin bypass — **no per-collection rules** ✅ free |
| public | built-in **Public** policy | — | **create-only** on `candidates`, **no read** — **wired Story 5.2** | AD-12 ✅ free (whole-collection create); the AD-12/AR-14 **hardening** = Directus IP rate limiter + form honeypot at the **edge** (a `preset`/`validation` on the grant stays 🔒/Option-3 — §3/§4/§0) |

🔒 = relies on a **custom permission rule** → requires a Directus license on the Core tier
(see §0). The **collection-level** grants (plain read/write on a whole collection) are free.

> **As-built vs upgrade-target (Option 3, §0).** Under the ratified Option 3, the 🔒 rows are
> **not** wired as row/field rules — each ships as a **full-collection grant + a UX guard**: the
> **Story 3.5 shell** for the Transfer/Guides surfaces, and — for `alliances-official` (**delivered
> Story 4.2**, live-verified) — **Owner discipline in the Data Studio** (Alliances CRUD is
> Data-Studio-only per AD-3; alliances are **not** in the custom Candidates shell — see §4
> mechanism 1). The 🔒 rule shown in this table and in §3 is the **Option-1 upgrade target** (flip it
> on the moment Directus is licensed), **not** the as-built config. Epics 4–6 wire the
> **full-collection** grant, not the 🔒 rule — see each mechanism's blockquote in §4.
>
> **Note the widened surface for `alliances-official`:** the only free update grant is
> `fields:["*"]`, so an Official can also write **`official`** (AD-9) and **`slug`** (AR-18) on **any**
> row — not merely a peer's row. This is wider than the row-scoping the AC names; it is the ratified
> Option-3 softening (§0, §4 mechanism 1), reduced — not closed — by the free interface guards
> (Task 2) and Owner discipline.

> **Curator ≠ stack both.** A Curator is given `transfer-curator` *instead of*
> `transfer-viewer` (curator already includes read). Don't attach both.

> **Accounts is Owner-only — there is no `accounts-*` leader policy.** The fourth governed area
> (Transfer, Guides, Alliances, **Accounts**) is the one with **no** per-area leader policy:
> creating accounts and changing roles is the Owner's exclusive domain via the built-in
> **Administrator** (`admin_access`) — exactly the AD-9 `users / roles / policies → Owner` row
> (§3), enforceable-now and license-free. The day-to-day account lifecycle (create / assign /
> reset / offboard) is **delivered in [`README.md` §8](README.md)** (Story 3.4).

> **Own-profile scope (resolves the 3.3-review deferral — a resolution, not a new open question).**
> A leader's **read-own-profile** is served by Directus's built-in **`/users/me`** (proven in
> Story 3.2 — `getCurrentUser()` → `readMe()` returned the leader's own record), so the base
> `Leader` role needs **no** `directus_users` read grant — a collection-level read grant would
> leak **all** leaders' emails/data. A **scoped own-profile *edit*** (`directus_users` update
> filtered `{ "id": { "_eq": "$CURRENT_USER" } }`, `role` / `policies` excluded) is a **custom
> permission rule → `403 RESOURCE_RESTRICTED` on the Core tier (Option 3, §0)**, so leader
> self-service profile editing is **not offered**; **all account edits stay Owner-only** unless
> Directus is licensed.

**Role table — reconciling epics vs UX terminology (use these exact names, from EXPERIENCE.md
§Roles & Access + PRD FR-12).** A **Guides Viewer** = a leader who *reads* drafts
(leader-visible, not public) but cannot edit/publish.

| Area | Role (exact) | Mode chip (`{Role} · {Mode}`, rendered by 3.5) | Can | Cannot |
|---|---|---|---|---|
| Transfer | **Viewer** (~8 leaders) | `Transfer · Read` | see all candidates + status (transparency-by-design) | any write/marking → **403** |
| Transfer | **Curator** (≤2, anti-bias) | `Transfer · Work` | Viewer + advance status, set planned_path / suggested_alliance, link groups, mark Transferred, Reject, Delete, read counters | (bounded by the ≤2 admin cap) |
| Guides | **Viewer** | `Guides · Read` | read drafts + published (`guide_drafts` + `guides`) | edit / publish |
| Guides | **Editor** (many) | `Guides · Work` | create/edit drafts in `guide_drafts`, assign category | write `guides` (publish) → **403** *(server-enforced, Option 2)* |
| Guides | **Senior** | `Guides · Work+` | Editor + **publish** = create/update `guides` (materialize a published row from a draft) | — |
| Alliances | **Alliance Official** (1/alliance) | `Alliances · Work` | edit alliance rows in the Data Studio (name, 2× Bear Trap, peak, farm); as-built the grant is **full-collection** (`fields:["*"]`), so own-row + own-fields are **Owner discipline**, not server-scoped | *no server-enforced row/field limit under Option 3 — cross-row / `official` / `slug` edits are Owner discipline, **not** a 403 (a non-Official gets 403 at the collection level); see §3 / §4* |
| all | **Owner** (Sabo) | `Owner · all` | provision accounts + roles; edit all alliances; publish guides; full Curator powers | — (universal override) |

*(UX-DR-17 — the role chip + "tabs absent, not disabled" — is defined in epics.md §UX Design
Requirements and **delivered in Story 3.5**, not here. Context, not a 3.3 deliverable.)*

---

## 3. Per-policy permission matrix (the single source of truth for Epics 4–6)

Each row is **collection · action · fields · row-filter · notes**. Every rule whose collection
**does not exist yet** is marked ⏳ with the story that lands it — that later story attaches the
grant to the **same** policy named here. 🔒 marks a rule that needs a Directus license (§0).

### `transfer-viewer` (Transfer · Read)
| Collection | Action | Fields | Row filter | Status |
|---|---|---|---|---|
| `candidates` | read | `["*"]` | — | collection ✅ **created Story 5.1**; read grant ✅ **wired Story 5.4** · ✅ free (collection-level — a Viewer sees all fields; a field subset / row filter is 🔒 §0, re-proven 403 `RESOURCE_RESTRICTED`) |
| `transfer_groups` | read | `["*"]` | — | collection ✅ **created Story 5.1** (shell); read grant ⏳ **re-deferred at Story 5.6** · ✅ free when wired — 5.6's divergent flag, gold/danger accents and group summary all derive from `candidates.group` + `candidates.suggested_alliance` (which a Viewer already reads), so a `transfer_groups` read is **only** needed to display group **names/labels**, which 5.6 does not (groups are labelled by membership). Wire this when group names are surfaced |
| `transfer_period` | read | `["*"]` | — | collection ✅ **created Story 5.1**; read grant ✅ **wired Story 5.4** (also serves 5.7 counter denominators) · ✅ free |
| `alliances` | read | `["*"]` | — | read grant ✅ **wired Story 5.4** — lets the candidate list resolve `desired_alliance` / `suggested_alliance` M2O → **name** live at runtime (Option B, Sabo 2026-07-09); whole-collection read ✅ free, alliance data is already public (Finder). **Grant surface (be honest):** the candidate-list *query* expands only `id`+`name`, so the list never **surfaces** `official`; but the Core-forced `["*"]` grant does let a Viewer **read** the `official` FK directly via the API — an opaque `directus_users` id only, no user PII (Viewers have no `directus_users` read grant) |

### `transfer-curator` (Transfer · Work) — Viewer + writes
| Collection | Action | Fields | Row filter | Status |
|---|---|---|---|---|
| `candidates` | read | `["*"]` | — | collection ✅ **created Story 5.1**; read grant ✅ **wired Story 5.5** (Curator = Viewer + writes) · ✅ free |
| `candidates` | update | `["*"]` **as-built (Option 3)** | — | ✅ **wired Story 5.5** · whole-collection ✅ free — the field-limited `["status","planned_path","suggested_alliance","group"]` is the 🔒 **Option-1 target** (a full update lets a Curator rewrite the public core/`desired_alliance` **or re-stamp `period`**, violating AD-8/AD-9/AD-17 — UX/convention only, see note) |
| `transfer_period` | read | `["*"]` | — | ✅ **wired Story 5.5** · free — window context (a Curator holds `transfer-curator` *instead of* `transfer-viewer`, so this policy carries its own reads; 5.7 counter denominators) |
| `alliances` | read | `["*"]` | — | ✅ **wired Story 5.5** · free — resolve `desired_alliance`/`suggested_alliance` **names** live (same M2O deep-expand as the 5.4 Viewer list; alliance data is already public via the Finder) |
| `candidates` | delete | — | — | ✅ **wired Story 5.8** · whole-collection ✅ free — `delete` has **no** field/row/validation axis, so the free whole-collection shape is the **only** shape (no Option-1 tension, unlike `update`). Powers the Curator per-row **Delete** (any status) + the between-windows **cleanup** (terminal rows only). The server 403 for a Viewer/anon (grant absent here) **is** the AC-4 "denied server-side" gate; `candidates` is a schema leaf (nothing references a candidates row), so a hard delete leaves no FK orphan |
| `transfer_groups` | **create / read / update / delete** | `["*"]` | — | ✅ **wired Story 5.6** · whole-collection ✅ free — **read is required** (not optional): after `POST /items/transfer_groups` the new group's **id is echoed only if the role can read** the collection, and the linking flow needs that id to stamp `candidates.group`. Membership lives on `candidates.group` (the 5.5 `candidates` update grant); the group-level suggestion is a **fan-out** of `candidates.suggested_alliance`, and `transfer_groups` has **no** suggested column (AR-10) |

> *Story-tag semantics (Transfer):* the **`candidates`, `transfer_period`, `settings` (singleton) and
> `transfer_groups` (shell) collections were created in Story 5.1** (data model + config — `README.md` §10
> + `directus-schema.yaml`, live-verified). The ⏳ tags above name the story that **wires each grant** onto
> those collections — **5.2** Public create-only, **5.4** Viewer read (candidate list — ✅ **delivered**:
> `candidates` + `transfer_period` reads, plus a free `alliances` read so the list resolves M2O alliance
> **names** live at runtime, Option B), **5.5** Curator
> work-field update, **5.6** `transfer_groups` CRUD, **5.8** Curator delete (✅ **delivered** — per-row Delete + between-windows cleanup). The **`settings` singleton** has
> a *separate* read consumer, not a Transfer grant row: `settings.special_invite_power_threshold` is read by
> the **5.3** `>130M` form-edge compare. **Mechanism decided + delivered (Story 5.3): a build-time
> static-token read** on the `finder-build-read` policy (like §9.5 alliances) — **not** a `transfer-viewer`
> grant (that leader-side read would not serve the public form) and **not** a Public read (AD-12 keeps Public
> write-only). The threshold is baked into `/join` at build; a Public runtime read is forbidden and a
> field-subset read is 🔒 (§0). **No grant was wired in 5.1**
> (the 4.1 fence). **Under Option 3 (§0), the Curator's 5.5 update grant is full-collection** — so the
> AD-8/AD-9 **distinct-writer** boundary (a Curator must not touch the public core / `desired_alliance`)
> and the AD-17 **`period` never-re-stamped** immutability are **UX/convention, NOT server-enforced**
> (each is a 🔒 field/validation rule — re-proven **`403 RESOURCE_RESTRICTED`** on `candidates`, README
> §"Candidates … Story 5.1"). ⚠ The `period` re-stamp is a **silent** carry-over corruption vector (not the
> reparable, backup-caught edit Option 3 assumed) — the decision-needed **AD-17** item deferred to Epic-5
> start (`deferred-work.md`); flip the 🔒 field/validation rule on under Option 1 (license) or split-out
> under Option 2 to close it. **Decision (Sabo, Story 5.5, 2026-07-09): proceed under Option 3** — the free whole-collection grant is wired; the **5.5 admin UI sends only `{status, planned_path}`, never `period`** (`admin/index.astro` `writeCandidate`; the shell exposes no `period` control), so a re-stamp cannot happen on the normal work path (only a hand-crafted raw-API call or a bug could — proportionate for the ≤2-trusted-Curator scope + daily backups). The Option-1 upgrade path stays clean.

> **Guides = Option 2 (split collections), amended 2026-07-14 (§0).** Draft-vs-published is
> **collection membership** (`guide_drafts` vs `guides`), **not** a `status` field. Every grant
> below is a **free whole-collection grant** — the publish gate is the *separation*
> (`guides-editor` has **no** `guides` write), which makes it **server-enforced on Core with no
> license** (live-proven Story 6.1). This replaces the earlier field-level (🔒) rows.

### `guides-viewer` (Guides · Read) — read drafts + published
| Collection | Action | Fields | Row filter | Status |
|---|---|---|---|---|
| `guide_drafts` | read | `["*"]` | — (leader-visible drafts) | ✅ **wired Story 6.1** · free |
| `guides` | read | `["*"]` | — | ✅ **wired Story 6.1** · free |
| `categories` | read | `["*"]` | — | ✅ **wired Story 6.1** · free |

### `guides-editor` (Guides · Work) — author drafts; **cannot publish (server-enforced)**
| Collection | Action | Fields | Row filter | Status |
|---|---|---|---|---|
| `guide_drafts` | create | `["*"]` | — | ✅ **wired Story 6.2** · free (live-proven: Editor create → 200) |
| `guide_drafts` | update | `["*"]` | — | ✅ **wired Story 6.2** · free (live-proven: Editor update → 200) |
| `guide_drafts` | read | `["*"]` | — | ✅ wired Story 6.1 · free |
| `categories` | read | `["*"]` | — | ✅ wired Story 6.1 · free |
| `guides` | *(none)* | **NO GRANT** | — | **the publish gate — no `guides` write → real 403 (live-proven 6.1)** |

### `guides-senior` (Guides · Work+) — **publish** (writes `guides`) + the free reads
| Collection | Action | Fields | Row filter | Status |
|---|---|---|---|---|
| `guide_drafts` | read | `["*"]` | — | ✅ wired Story 6.1 · free |
| `guides` | read | `["*"]` | — | ✅ wired Story 6.1 · free |
| `categories` | read | `["*"]` | — | ✅ wired Story 6.1 · free |
| `guide_drafts` | update | `["*"]` | — | ✅ **wired Story 6.3** · free (live-proven: Senior update → 200) — re-edit a draft before re-publishing |
| `guides` | create | `["*"]` | — | ✅ **wired Story 6.3** · free (live-proven: Senior create → 200, slug+body verbatim) — **the publish action** (materialize a published row from a draft, same slug) |
| `guides` | update | `["*"]` | — | ✅ **wired Story 6.3** · free (live-proven: Senior update → 200) — re-publish / correct a published guide |

> *Story-tag semantics (Option 2):* the **`categories` + `guide_drafts` + `guides` collections
> are created in Story 6.1** (+ the free **reads** wired). The publish gate is a **collection
> boundary**, not a field rule — `guides-editor` gets **no `guides` write grant**, so an Editor
> publish attempt is a genuine server-side **403** (live-proven 6.1 + 6.2 + 6.3), *free* on Core. **6.2
> wired** the Editor `guide_drafts` write (create + update; live-proven Editor 200 on `guide_drafts`,
> 403 on `guides`); **6.3 wired** the Senior `guides` writes (the publish action; live-proven Senior
> 200 / Editor+Viewer 403) + the draft→published **copy mechanism**: NOT a custom approval Flow
> (AD-6/AD-7 hold) — publish is the admin-shell **Guides panel** copying the draft **verbatim in code**
> via the leader session (`publishGuide()`, README §19.2; Option B, Sabo 2026-07-16 — slug-equality
> structurally guaranteed, a recorded minimal deviation from AR-5's one-custom-surface letter).
> The publish→rebuild **Flow** (README §19.3) fires on `guides`+`categories` writes, never on
> `guide_drafts` (live-proven). `categories` CRUD is **Owner-only** (§AD-9): leaders read + assign,
> never create. The Senior **role** layers this policy on `guides-editor` (author drafts *and*
> publish — the "Work+" in the name); a Senior needs a **Studio seat** only for authoring — the
> publish surface runs on the session API (see the §0 seats note / README §19.4).

### `alliances-official` (Alliances · Work)
| Collection | Action | Fields | Row filter | Status |
|---|---|---|---|---|
| `alliances` | read | `["*"]` | — | ✅ **delivered Story 4.2** · free |
| `alliances` | update — **as-built (Option 3)** | `["*"]` (all fields, incl. `official`/`slug`) | — none | ✅ **delivered Story 4.2** · free — the **only** free update shape (§0) |
| `alliances` | update — *Option-1 target* | `["name","bear_trap_1","bear_trap_2","peak","farm_alliance"]` (excludes `official`, `slug`) | **`{ "official": { "_eq": "$CURRENT_USER" } }`** | 🔒 licensed (AD-5) — flip on license |

> **Collection status:** the `alliances` collection + fields were **created in Story 4.1** (canonical
> AD-18 shape, Owner CRUD, seeded from the static mirror — see `README.md` §9 and
> `directus-schema.yaml`). **Story 4.2 wired the two as-built grants above** (read `["*"]` + update
> `["*"]`, `permissions:{}`) — live-verified against `directus:12.0.2` (README §9.4).
>
> **The Option-3 softening here is wider than row-scoping.** Because the only free update grant is
> `fields:["*"]` (a field subset OR a row filter each `403 RESOURCE_RESTRICTED` — §0 proof, re-proven
> in 4.2), the Official's grant can write **any field on any row** — not only a peer's row but also
> **`official`** (reassign the alliance's leader → violates AD-9 "only the Owner assigns `official`")
> and **`slug`** (rewrite the immutable public address → AR-18). So the field-exclusion of
> `official`/`slug` is **also** an Owner-discipline + free-interface-guard convention (Task 2), **not
> only** the row-scoping — it is *not* server-held. The Option-1 target row above restores both the
> field subset and the row filter the moment Directus is licensed. **Do NOT grant `create`/`delete`**
> to this policy — the Owner creates/deletes alliances (AD-9 / FR-3).

### `finder-build-read` (Build · Read) — the SSG read token (Stories 4.3 / 5.2 / 5.3 / 6.4)
| Collection | Action | Fields | Row filter | Status |
|---|---|---|---|---|
| `alliances` | read | `["*"]` (all fields) | — none | ✅ **delivered Story 4.3** · whole-collection read = free (§0) |
| `transfer_period` | read | `["*"]` (all fields) | — none | ✅ **delivered Story 5.2** · the active period id `/join` stamps into `candidates.period` · whole-collection read = free |
| `settings` (singleton) | read | `["*"]` (all fields) | — none | ✅ **delivered Story 5.3** · the `special_invite_power_threshold` the `/join` power-badge compares against · whole-collection read = free |
| `guides` | read | `["*"]` (all fields) | — none | ✅ **wired Story 6.4** · the public-build source (Option 2: membership = published) · whole-collection read = free |
| `categories` | read | `["*"]` (all fields) | — none | ✅ **wired Story 6.4** · category browse pages + chips + manual sort · whole-collection read = free |
| `directus_files` | read | `["*"]` (all fields) | — none | ✅ **wired Story 6.4** · guide-image originals for the build's download-optimize-localize step — **measured**: `GET /assets/<id>` is 403 for anon AND for a token without this grant (README §20.1) · whole-collection read = free |

> Not a leader role — a **service policy** attached to a dedicated `finder-build` user whose **static
> token** the Astro build uses to pull build-time data (AR-18: "the build pulls with a read-only token").
> It grants **read on `alliances`, `transfer_period`, the `settings` singleton, `guides`, `categories`
> and `directus_files` only** — nothing else, no write, **no `guide_drafts`** (drafts stay leader-only;
> a build-token GET on `guide_drafts` is a live-proven 403, Story 6.4). This is why **Public stays
> locked** (AD-12): the build authenticates with its own token instead of opening the collections to
> the world. The `finder-build` user has no `app_access` → consumes **no Studio seat** (§0 seats note).
> The token lives in the `DIRECTUS_TOKEN` build secret (non-`PUBLIC_`, never in the client bundle); the
> grant lives only in `data.db` (backed up, §6), not in `directus-schema.yaml`. Runbook: `README.md`
> §9.5 (+ §11.2 for the `transfer_period`/`settings` reads, §20.1 for the guides/categories/files reads).
> When Directus is licensed, these can tighten to field-subsets / published-only, but on Core the
> whole-collection read is the free, correct shape.

### `Public` (built-in, unauthenticated)
| Collection | Action | Fields | Row filter | Status |
|---|---|---|---|---|
| `candidates` | **create** | `["*"]` | none (`permissions: {}`) | **wired Story 5.2** — the whole-collection create grant (the only free create shape, §0 line proof). The `/join` form posts here as the anonymous role. |
| `candidates` | ~~read~~ | — | — | **NOT granted** — deny-by-default keeps it write-only; an unauthenticated `GET`/list of `candidates` → 403 (AD-12: create-only, no read). |
| (everything else) | — | — | — | **no access** (verified via unauthenticated `GET /users`/`/roles`/`/policies` → 403). Confirmed **no `alliances` / `transfer_period` / `settings` / `guides` / `categories` read** (anon GET `guides`/`categories` → 403 re-proven Story 6.4) — the build reads all of those via the `finder-build-read` token, not Public. |

> **Hardening is at the edge, not in the grant (Option 3, §0/§4).** The create grant is `fields:["*"]`,
> so a hostile client *could* send Curator-only fields (`status`, `suggested_alliance`); locking the
> payload with a `preset`/field-subset/`validation` is 🔒 licensed. Instead: `status` rides its schema
> **default `Applied`** (client omits it); `period` is **client-sent** (the build-time-baked active id,
> README §11); abuse floor = the Directus **IP rate limiter** (`RATE_LIMITER_*`, docker-compose) **+ a
> form honeypot**. The residual (a raw poster setting an unexpected field) is the accepted Option-3 limit.

### Owner (Administrator)
No per-collection rows — the `admin_access` bypass **is** the override (§4). Adding Owner
allow-rules is forbidden (they would look like a removable check).

### AD-9 — one primary writer per field-group (reproduced verbatim; the ownership backbone)
*(Source: ARCHITECTURE-SPINE.md §AD-9. Each field-group has exactly one primary writer + the
Owner as universal override.)*

| Field-group | Primary writer |
| --- | --- |
| `alliances` row | Alliance Official (own row) — Owner overrides any row |
| `candidates` core fields + `desired_alliance` | public create-only (a Curator may correct, but never copies `desired` into `suggested`) |
| `candidates.period` | public create-only (set to the active period at creation), **never re-stamped** (see AD-17) |
| `candidates` status / planned_path / suggested_alliance / group | Curator (group-level suggestion is the Curator fan-out of AD-8, not a separate store) |
| `guide_drafts` (all fields) | Editor — the draft working copy (Option 2, Story 6.1) |
| `guides` (published rows) | Senior — publish = materialize from a draft (same slug); Owner overrides (Option 2, Story 6.1) |
| `categories` (CRUD) | Owner — created in Story 6.1; leaders **read + assign**, never create (resolves the 3.3-deferred "categories write-owner unspecified" gap) |
| `transfer_period` (caps, active flag) | Owner |
| users / roles / policies | Owner |

The **`users / roles / policies → Owner`** row is the **enforceable-now** one (no domain
collection needed) — it is exactly what Story 3.3 proved: a non-admin leader gets **403** on
any write to `directus_users` / `directus_roles` / `directus_policies`; the Owner overrides.

Likewise **`transfer_period`** and the **`settings` singleton** (caps, active flag, kingdom-wide
thresholds) receive **no non-Owner *write* grant** in any per-area policy — **deny-by-default is the
Owner-only guard** (the Owner writes them via the admin bypass, per AD-9). A **read** grant for the
counter denominators (**caps on `transfer_period`**) is free and belongs to `transfer-viewer` /
`transfer-curator` (✅ read grant **wired Story 5.4/5.5**; ✅ **counter denominators now consumed Story
5.7** — the admin shell reads the active period at runtime via `getActivePeriod()` and derives the
per-path counters at the edge, no new grant). Separately, the **build token** (`finder-build-read`)
gets a free **read** on `transfer_period`
(**wired Story 5.2** — the `/join` build bakes the single active period id it stamps into
`candidates.period`; §2 / README §11) — a *read* only, still no write. The **`settings` threshold has a
*separate* reader**:
`settings.special_invite_power_threshold` is consumed by the **5.3** `>130M` form-edge compare — read
**mechanism decided + delivered (Story 5.3): a build-time static-token read** on this same
`finder-build-read` policy (baked into `/join`, like §9.5 alliances), **not** a `transfer-viewer` grant and
**not** a Public read. Do **not**
hand a Curator a `transfer_period`/`settings` *write* grant "for counters" — a Curator never writes
caps, the active flag, or a threshold. (**Epic 5.1 created `transfer_period` + `settings`** —
`README.md` §10; it attached **no** grant at all — every grant lands with its consuming story, §3.)

The **`candidates` delete** grant (**wired Story 5.8**, §3) is **not** a new AD-9 field-group — deleting the
whole applicant record is the same **Curator** authority that already owns `candidates` status /
planned_path / suggested_alliance / group; the Owner overrides via the admin bypass. It has no
field/row axis, so it is whole-collection ✅ free (no Option-1 tension). `candidates` is a schema **leaf**
(no collection references a candidates row — `transfer_groups` has no back-reference; membership lives on
`candidates.group`), so a hard delete leaves no dangling FK; a delete that drops a transfer group below 2
members is dissolved client-side (the same "no group of one" invariant as the 5.6 unlink).

---

## 4. The three special enforcement mechanisms (the crux of "server-enforced, not UI")

1. **Row-level — Alliance Official (AD-5).** A Directus **item permission** with the filter
   **`{ "official": { "_eq": "$CURRENT_USER" } }`** on `alliances` *update*. Officials get
   **own-row** write; every other row → 403. `$CURRENT_USER` resolves to the requester's user
   id at evaluation time. The *rule* specified here is the **Option-1 upgrade target** — it is
   **NOT** wired (it 403s on Core); **Story 4.2 wired the free full-collection grant instead** (see the
   blockquote below). **🔒 Requires a Directus license (§0)** — item filters are a custom
   permission rule; verified `403 RESOURCE_RESTRICTED` on the Core tier. The *identical*
   mechanism is `{ "id": { "_eq": "$CURRENT_USER" } }` for own-profile — the docs' canonical
   example.
   > **Per Owner decision (§0, Option 3): NOT implemented as a row filter — delivered in Story 4.2
   > as a full-collection grant (live-verified).** Officials share a **`fields:["*"]`,
   > `permissions:{}`** `alliances` update grant — the **only** free shape (§0 proof, re-proven in
   > 4.2: a field subset OR a row filter each returns `403 RESOURCE_RESTRICTED`). Because the grant is
   > `fields:["*"]`, the softening is **wider than row-scoping**: an Official can also write
   > **`official`** (reassign the alliance's leader → AD-9) and **`slug`** (rewrite the public address
   > → AR-18) on **any** row, not only a peer's. Mitigations are all UX / Owner-discipline (**not**
   > server rules): own-row + one-official editing is **Data-Studio Owner discipline** (Alliances CRUD
   > is Data-Studio-only per AD-3 — not the custom Candidates shell); free **interface guards** shrink
   > the *accidental* surface in the Studio (a `slug` `conditions` readonly-after-create — free,
   > verified; and, if wanted, a global `official` readonly — free but it also blocks the Owner's own
   > assignment, so it is optional — see README §9.4); and the daily `data.db` backup catches a bad
   > edit. A direct API call with the grant still reaches those fields/rows — the honest Option-3 limit
   > (NFR-9). This spec stays the **Option-1 upgrade target** — flip to the filter + field subset above
   > the moment Directus is licensed.

2. **Collection-level — Guides publish gate (AD-6, amended to Option 2 on 2026-07-14, §0).**
   The gate is **two collections**, not a field rule: `guide_drafts` (Editor-writable working
   copy) and `guides` (Senior/Owner-writable, the public-build source). `guides-editor` holds a
   **full-collection `guide_drafts`** write grant and **no grant on `guides`**; `guides-senior`
   holds the **full-collection `guides`** write grant. Publishing = a Senior copies a draft into
   `guides` (same immutable slug). This is **NOT** a Flow or hook (AD-6/AD-7 forbid a custom
   approval workflow — the copy mechanism stays a plain create/update). **Decided Story 6.3 (Sabo
   2026-07-16): the copy is the admin-shell Guides panel** — `publishGuide()` copies the draft
   **verbatim in code** over the leader session (create-or-update on `guides` keyed by slug; slug
   sent only on create → slug-equality structurally guaranteed; README §19.2). **✅ Free and
   server-enforced on Core** — collection grants are not a custom permission rule; **live-proven
   Story 6.1** (an Editor-scoped token got **200** on `guide_drafts`, **403** on `guides`) and
   re-proven 6.3 (Senior 200 / Editor + Viewer 403). Collections + free reads wired **6.1**; Editor
   `guide_drafts` write **6.2**; Senior `guides` writes (publish) **wired 6.3**.
   > **Why Option 2 here (not Option 3):** the guides gate controls **public visibility**, so it
   > is worth hard-enforcing — and the split does it for free, unlike the field-gate form (a field
   > subset → `403 RESOURCE_RESTRICTED` on Core, still 🔒). Slug immutability stays a free Studio
   > `readonly` condition + discipline (§0 / README §17). Option-1 (license) would additionally
   > allow the original single-collection `status` field-gate, but is not needed.

3. **Public lockdown (AD-12).** The built-in **Public** policy has **no access** now
   (verified via unauthenticated `GET /users` / `/roles` / `/policies` → 403 — 3 system
   endpoints, not an exhaustive public-surface audit). The **create-only, no-read** grant on
   `candidates` is added in **Story 5.2**, not here. The **basic** create-only-no-read grant is
   **free** (collection-level create + no read = deny-by-default); the AD-12/AR-14 **hardening**
   (a `preset` forcing `period`, field validation, rate-limit) is a 🔒 custom rule that inherits
   the same Option-3 license limit (logged for Epic 5.2). This locked baseline is the secure
   default before Epic 5 opens the single create-only grant.
   > **Per Owner decision (§0, Option 3): wired in Story 5.2 as the free whole-collection create grant.**
   > Public gets `candidates` **create**, `fields:["*"]`, `permissions:{}`, **no read** — the only free
   > shape (§0). The AD-12/AR-14 hardening that WOULD be a 🔒 custom rule is **not** wired on the grant;
   > instead:
   > - **`status`** rides the schema **default `Applied`** — the client omits it (free, no preset).
   > - **`period`** is sent by the **client** — the active-period id baked into `/join` at build time via
   >   the `finder-build-read` token's new `transfer_period` read (README §11 / §9.5). A `preset` forcing
   >   it would 🔒. A hostile client could send a wrong/extra field; that residual is the accepted Option-3
   >   limit (create-only-no-read + ~10-leader trust). The `period` FK (NO ACTION) rejects a nonexistent id.
   > - **Abuse floor** = Directus's built-in **IP rate limiter** (`RATE_LIMITER_*`, docker-compose — the
   >   server-side floor, effective even against direct API posts) **+ a form honeypot** (best-effort).
   >   Captcha stays deferred until real abuse appears (AD-12). The Caddy-scoped `rate_limit` (AD-12's
   >   letter) needs a non-stock plugin + custom image, so the native limiter is the KISS choice that keeps
   >   the pinned official images (Sabo, 2026-07-08). Runbook: README §11.

**Owner override (AD-9 / AR-11).** Owner = the built-in **Administrator** role
(`admin_access: true`), which **bypasses all permission checks by design** — the no-code
escape hatch satisfying "no unit can lock the Owner out." **Never** add per-collection Owner
allow-rules: the admin bypass *is* the override, and a per-collection rule would (a) be
redundant and (b) risk *looking* like the override lives in a rule a unit could remove.
Proven (Story 3.3): the Administrator overrides the very write that 403s the leader.

---

## 5. Curator ≤ 2 — administrative rule, not a runtime check (AC2, anti-bias)

The **permission boundary** (Curator *can* write, Viewer *cannot* → 403) **is** server-enforced
(proven under AC3). The **headcount** (at most two people hold `transfer-curator`) is **not** a
Directus-enforceable constraint — Directus has **no native "max N users per policy"** — and
every source frames it as governance ("~2 / ≤2 / deliberately limited"). So:

- **Enforce the boundary** in Directus (the policy).
- **Enforce the count** in the **runbook** (an Owner discipline): the Owner attaches
  `transfer-curator` to **at most two** accounts.
- **Do NOT build a headcount enforcer** — that is exactly the over-engineering the project
  conventions reject (KISS / YAGNI). A future reader must not "fix" this by adding a counter.

**Rationale (capture, don't lose):** ≤2 Curators = anti-bias (if every alliance leader could
accept/reject/suggest, each pulls candidates toward their own alliance); ~8 read-only Viewers =
transparency-by-design. [Source: FR-12; AR-7; PRD addendum bias rationale; EXPERIENCE.md.]

**One Alliance Official per alliance — also an Owner discipline under Option 3.** Like the
Curator cap, "1 Official/alliance" is **not** filter-enforced: Option 3 gives every
`alliances-official` a **full-collection** `alliances` update grant (**wired in Story 4.2**,
live-verified; the `official = $CURRENT_USER` row filter is the 🔒 Option-1 upgrade target). So an
Official editing **another** alliance's row is **UX-guided (Owner discipline in the Data Studio), not
a 403** (proven: a peer-row `PATCH` by an Official returns 200 — README §9.4), and attaching the
policy to two accounts for the same alliance is caught by **Owner discipline**, not the server. Do **not**
build a cardinality check (same KISS/YAGNI reasoning as the Curator cap).

### `app_access` per policy — ⏳ host-confirm when the shell + collections exist
Studio-using roles (Editor / Senior / Official / Owner) need `app_access: true`. The custom
Candidates-shell-only roles (Transfer Viewer / Curator) **may** be API-only *without*
`app_access` — they never open the Data Studio; they use the custom admin shell (Story 3.5). Do
**not** over-prescribe now: confirm the exact implication against the running Directus when the
Candidates shell + collections exist (Epic 5). (Login/API access does **not** require
`app_access` — verified: the Story 3.3 test leader had `app_access: false` and still
authenticated + hit the API.)

---

## 6. Recovery / reproducibility (the honest limit)

`directus schema snapshot` / `schema apply` (and the `schemaSnapshot` / `schemaDiff` /
`schemaApply` SDK calls) capture **`collections` / `fields` / `relations` ONLY** — **not**
`directus_roles` / `directus_policies` / `directus_permissions` / `directus_users` /
`directus_access`. There is **no first-class permissions export** in core Directus. Therefore:

- **Version-controlled source of truth = this file** (`infra/roles-and-policies.md`),
  human-authored and reviewable.
- **Recovery of the running config = the Story 3.1 daily `sqlite3 .backup` of `data.db` → R2**
  (roles/policies/permissions all live in that one SQLite file).
- **From-scratch reproduction = an Owner re-applies this spec in the Data Studio** per
  `README.md` §7.

**Ordering traps when reproducing from scratch:** (1) a collection must exist (via `schema
apply`) **before** any grant that references it can be attached; (2) a Studio-using policy needs
`app_access: true` set **before** that leader can log in to the Data Studio to help operate;
(3) restoring **only** a `schema snapshot` (which excludes permissions) recreates collections
with **zero** permission rows → deny-by-default locks everyone out (fails **closed** — good),
but the fix must be re-applying this spec's grants, **not** a hasty broad grant that could
over-open (Public, or a full-collection grant to the wrong policy). Always restore the `data.db`
backup for the running role config; use `schema apply` only to rebuild the **data model**.

This "config in the Studio, not IaC" posture is an **accepted trade-off already ratified by
Story 3.1** ("stack lifecycle managed manually on the host via the runbook … no container
CD/IaC — KISS for a single hobby host"). **No** Directus SDK roles-bootstrap script: it is
YAGNI (a handful of policies, one hobby host, ~10 users), it would need re-editing every epic
as collections land, and it would drift against the manual Data-Studio edits AD-3 mandates. If
the Owner later wants one, it is a clean separate task. [Source: ctx7 `/directus/docs`
schema-snapshot scope; Story 3.1 §Task 5 boundary; code-conventions §"When in doubt".]

---

## 7. Applying this model — pointer

The step-by-step Data-Studio runbook (order to create policies, how leaders receive a
*combination* of per-area policies, the Owner = Administrator mapping, the Public = no-access
check, the Curator ≤2 discipline, and the first-login role smoke test) lives in
[`README.md` §7 "Roles, policies & permissions"](README.md). The **account lifecycle** that
*consumes* those policies — how the Owner creates each leader's user account, attaches the
policy combination, resets a password, and offboards — is [`README.md` §8 "Leader accounts"](README.md)
(Story 3.4). This file is the **what** (the contract); the README is the **how-to-apply**.

---

## References
- Directus 12 access model, `/permissions/me`, `$CURRENT_USER` examples, **and license
  enforcement** — ctx7 `/directus/docs` (2026-07-01).
- ARCHITECTURE-SPINE.md §AD-3 (headless / Data Studio), §AD-4 (authority in Directus), §AD-5
  (per-area roles, `official = $CURRENT_USER`), §AD-6 (publish field-gate), §AD-7 (transitions
  are frontend-guided — **no** server state machine), §AD-9 (one primary writer + Owner
  override), §AD-12 (Public create-only baseline).
- epics.md §Epic 3 Story 3.3 ACs (source of truth), §FR-12/FR-13/FR-14, §NFR-8/NFR-9,
  §AR-6/AR-7/AR-11/AR-14, §FR Coverage Map (FR-12 split across Epic 3 + Epic 4).
- Story 3.1 (infra + backup + no-IaC posture), Story 3.2 (auth/gate this model sits on;
  mechanism-now-collections-later AC pattern).
- code-conventions.md §Security (no hand-rolled auth/crypto; least privilege), §Anti-patterns
  (no premature abstraction), §"When in doubt" (easier to delete than extend).
