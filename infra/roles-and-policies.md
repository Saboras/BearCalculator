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
| **AD-6 — Guides publish gate** (`status` field-level, Editor excluded) | custom permission rule (field) | ⛔ **licensed** |
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
| AD-5 — Alliance Official edits **own row only** (`official = $CURRENT_USER`) | All Officials share a **full-collection `alliances` update** grant; own-row is enforced **only by the admin shell UI** (each Official sees/edits just their row). | ❌ no — UX-guided; a direct API call could touch another row |
| AD-6 — **only Senior** may set `guides.status = published` (field-gate) | Editor + Senior share a **full-collection `guides` update** grant; the publish control is **hidden from Editors in the UI**. | ❌ no — UX-guided; an Editor could publish via a direct API call |
| Curator writes **only** work-fields on `candidates` (field subset) | Curator gets a **full-collection `candidates` update** grant; the "don't touch the public core / `desired_alliance`" boundary (AD-8/AD-9) is a **UX + convention** guard. | ❌ no — UX-guided |

The **collection boundaries stay server-enforced** (proven): a Transfer/Guides **Viewer** has
**no** write grant → **403** on any write (AC3); the **Owner** overrides (AC4); **Public** is
locked. So "a Viewer can never do a Work action" holds at the server; what is *not* server-held
under Option 3 is the *within-a-writer-role* fineness (which row / which field).

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
| Transfer | `transfer-viewer` | ⏳ see §5 | **read** `candidates` (+ groups, period) — no writes | collection **read** grant ✅ free |
| Transfer | `transfer-curator` | ⏳ see §5 | Viewer + **create/update/delete** `candidates` work-fields (status / planned_path / suggested_alliance / group); read counters | collection **write** grant ✅ free; *field-limited to work-fields* 🔒 |
| Guides | `guides-viewer` | yes | **read** drafts (`guides` non-published, leader-visible) | collection **read** grant ✅ free |
| Guides | `guides-editor` | yes | create/update **`guides.body` / `category`** drafts — **cannot** set `status = published` | **field-level** (status excluded) 🔒 |
| Guides | `guides-senior` | yes | Editor **+** write **`guides.status = published`** | **field-level** on `status` (AD-6) 🔒 |
| Alliances | `alliances-official` | yes | update **own** `alliances` row only (name, `bear_trap_1`, `bear_trap_2`, `peak`, `farm_alliance`) | **row filter `official = $CURRENT_USER`** (AD-5) 🔒 |
| all | **Owner** = built-in **Administrator** role (`admin_access: true`) | — | **everything** (universal override) | admin bypass — **no per-collection rules** ✅ free |
| public | built-in **Public** policy | — | **nothing** now; Epic 5.2 adds **create-only** on `candidates`, **no read** | locked baseline (AD-12) ✅ free (basic create-only; the AD-12/AR-14 field/validation/rate-limit **hardening** is 🔒 — §3/§0) |

🔒 = relies on a **custom permission rule** → requires a Directus license on the Core tier
(see §0). The **collection-level** grants (plain read/write on a whole collection) are free.

> **As-built vs upgrade-target (Option 3, §0).** Under the ratified Option 3, the 🔒 rows are
> **not** wired as row/field rules — each ships as a **full-collection grant + a UX guard in the
> Story 3.5 shell**. The 🔒 rule shown in this table and in §3 is the **Option-1 upgrade target**
> (flip it on the moment Directus is licensed), **not** the as-built config. Epics 4–6 wire the
> **full-collection** grant, not the 🔒 rule — see each mechanism's blockquote in §4.

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
| Guides | **Viewer** | `Guides · Read` | read drafts | edit / publish |
| Guides | **Editor** (many) | `Guides · Work` | create/edit drafts, assign category (`body` / `category`) | set `status = published` → **403** |
| Guides | **Senior** | `Guides · Work+` | Editor + approve / **publish** (`status`) | — |
| Alliances | **Alliance Official** (1/alliance) | `Alliances · Work (row-scoped)` | edit **own** row only (name, 2× Bear Trap, peak, farm) | edit another row → **403** |
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
| `candidates` | read | `["*"]` | — | ⏳ Epic 5.1 · ✅ free (collection-level) |
| `transfer_groups` | read | `["*"]` | — | ⏳ Epic 5.6 · ✅ free |
| `transfer_period` | read | `["*"]` | — | ⏳ Epic 5.1 · ✅ free |

### `transfer-curator` (Transfer · Work) — Viewer + writes
| Collection | Action | Fields | Row filter | Status |
|---|---|---|---|---|
| `candidates` | read | `["*"]` | — | ⏳ Epic 5.1 · ✅ free |
| `candidates` | update | `["status","planned_path","suggested_alliance","group"]` | — | ⏳ Epic 5.5 · 🔒 field-limited (else full-update is free but lets a Curator rewrite the public core/`desired_alliance`, violating AD-8/AD-9) |
| `candidates` | delete | — | — | ⏳ Epic 5.8 · ✅ free |
| `transfer_groups` | create/update/delete | `["*"]` | — | ⏳ Epic 5.6 · ✅ free |

### `guides-viewer` (Guides · Read)
| Collection | Action | Fields | Row filter | Status |
|---|---|---|---|---|
| `guides` | read | `["*"]` | — (leader-visible drafts) | ⏳ Epic 6.1 · ✅ free |
| `categories` | read | `["*"]` | — | ⏳ Epic 6.1 · ✅ free |

### `guides-editor` (Guides · Work) — create/edit drafts, **never publish**
| Collection | Action | Fields | Row filter | Status |
|---|---|---|---|---|
| `guides` | create | `["title","body","category"]` — **`status` NOT writable at create; it defaults to a draft value** (a value-gate that *allowed* `status` but forbade `published` would itself need a 🔒 `validation` rule) | — | ⏳ Epic 6.2 · 🔒 field-level |
| `guides` | update | `["title","body","category"]` — **`status` EXCLUDED** | — | ⏳ Epic 6.2 · 🔒 field-level (AD-6) |
| `categories` | read | `["*"]` | — | ⏳ Epic 6.1 · ✅ free |

### `guides-senior` (Guides · Work+) — Editor + publish
| Collection | Action | Fields | Row filter | Status |
|---|---|---|---|---|
| `guides` | update | `["title","body","category","status"]` — **`status` INCLUDED** (may set `published`) | — | ⏳ Epic 6.3 · 🔒 field-level (AD-6) |

> *Story-tag semantics:* the **`guides` + `categories` collections are created in Story 6.1**;
> the ⏳ tags above name the story that **wires each grant** onto that collection — **6.1** read
> (Viewer), **6.2** draft create/update (Editor), **6.3** publish (Senior). No grant attaches
> before 6.1 creates the collection.

### `alliances-official` (Alliances · Work, row-scoped)
| Collection | Action | Fields | Row filter | Status |
|---|---|---|---|---|
| `alliances` | read | `["*"]` | — | ⏳ Epic 4.2 · ✅ free |
| `alliances` | update | `["name","bear_trap_1","bear_trap_2","peak","farm_alliance"]` | **`{ "official": { "_eq": "$CURRENT_USER" } }`** | ⏳ Epic 4.2 · 🔒 row filter (AD-5) |

### `Public` (built-in, unauthenticated)
| Collection | Action | Fields | Row filter | Status |
|---|---|---|---|---|
| — | — | — | — | **no access now** (verified via unauthenticated `GET /users`/`/roles`/`/policies` → 403 — 3 system endpoints, not an exhaustive public-surface audit). ⏳ Epic 5.2 adds **`candidates` create-only, no read** (AD-12) · basic create-only ✅ free, the field/validation/rate-limit **hardening** 🔒 |

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
| `guides` body / category | Editor |
| `guides` status (publish) | Senior (Owner overrides) |
| `transfer_period` (caps, active flag) | Owner |
| users / roles / policies | Owner |

The **`users / roles / policies → Owner`** row is the **enforceable-now** one (no domain
collection needed) — it is exactly what Story 3.3 proved: a non-admin leader gets **403** on
any write to `directus_users` / `directus_roles` / `directus_policies`; the Owner overrides.

Likewise **`transfer_period`** (caps, active flag) receives **no** policy grant in any per-area
policy — **deny-by-default is the Owner-only guard** (Owner writes it via the admin bypass, per
AD-9). Do **not** hand a Curator a `transfer_period` grant "for counters": a Curator reads
counters through the `candidates` / `transfer_groups` grants and **never** writes caps or the
active flag. (Epic 5.1 lands the collection; it attaches **no** non-Owner grant.)

---

## 4. The three special enforcement mechanisms (the crux of "server-enforced, not UI")

1. **Row-level — Alliance Official (AD-5).** A Directus **item permission** with the filter
   **`{ "official": { "_eq": "$CURRENT_USER" } }`** on `alliances` *update*. Officials get
   **own-row** write; every other row → 403. `$CURRENT_USER` resolves to the requester's user
   id at evaluation time. Wired in **Story 4.2** when `alliances` exists; the *rule* is
   specified here. **🔒 Requires a Directus license (§0)** — item filters are a custom
   permission rule; verified `403 RESOURCE_RESTRICTED` on the Core tier. The *identical*
   mechanism is `{ "id": { "_eq": "$CURRENT_USER" } }` for own-profile — the docs' canonical
   example.
   > **Per Owner decision (§0, Option 3): NOT implemented as a row filter.** Officials share a
   > full-collection `alliances` update grant; own-row is guided by the Story 3.5 shell UI, not
   > server-enforced. This spec stays the **Option-1 upgrade target** — flip to the filter above
   > the moment Directus is licensed.

2. **Field-level — Guides publish gate (AD-6).** `guides.status` is writable to `published`
   **only** by `guides-senior` / Owner. `guides-editor` may write `body` / `category` but the
   `status` field is **excluded from its update `fields`**. A Directus **field-level
   permission** — **not** a Flow or hook (AD-6 forbids a custom approval workflow). Wired in
   **Epic 6**. **🔒 Requires a Directus license (§0)** — field subsets are a custom permission
   rule; verified `403 RESOURCE_RESTRICTED` on the Core tier.
   > **Per Owner decision (§0, Option 3): NOT implemented as a field-level permission.** Editor
   > + Senior share a full-collection `guides` update grant; the publish control is hidden from
   > Editors in the Story 3.5 shell, not server-enforced. Option-1 (license) upgrade target — or
   > Option 2 (split `drafts`/`published` collections) if this one boundary later needs hard
   > enforcement without licensing.

3. **Public lockdown (AD-12).** The built-in **Public** policy has **no access** now
   (verified via unauthenticated `GET /users` / `/roles` / `/policies` → 403 — 3 system
   endpoints, not an exhaustive public-surface audit). The **create-only, no-read** grant on
   `candidates` is added in **Story 5.2**, not here. The **basic** create-only-no-read grant is
   **free** (collection-level create + no read = deny-by-default); the AD-12/AR-14 **hardening**
   (a `preset` forcing `period`, field validation, rate-limit) is a 🔒 custom rule that inherits
   the same Option-3 license limit (logged for Epic 5.2). This locked baseline is the secure
   default before Epic 5 opens the single create-only grant.

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
Curator cap, "1 Official/alliance" is **not** filter-enforced now: Option 3 gives every
`alliances-official` a **full-collection** `alliances` update grant (the `official =
$CURRENT_USER` row filter is the 🔒 Option-1 upgrade target). So an Official editing **another**
alliance's row is **UX-guided in the 3.5 shell, not a 403**, and attaching the policy to two
accounts for the same alliance is caught by **Owner discipline**, not the server. Do **not**
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
