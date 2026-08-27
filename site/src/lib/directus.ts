import {
  createDirectus,
  authentication,
  rest,
  readMe,
  readItem,
  readItems,
  updateItem,
  updateItems,
  createItem,
  deleteItem,
  deleteItems,
  readUsers,
} from '@directus/sdk';

/*
  Session-cookie mode is deliberate and security-load-bearing:
  `login({ mode: 'session' })` makes Directus set the httpOnly `directus_session_token`
  cookie and returns NO token in the body. `credentials: 'include'` on both composables
  is what sends/receives that cookie cross-subdomain (apex site ↔ admin subdomain).
  The credential therefore lives only in a browser-managed httpOnly cookie, never in JS
  or localStorage. Never switch to `mode: 'json'` (that returns access_token in the
  body → would have to be stored).
*/
// `||` not `??`: an empty PUBLIC_DIRECTUS_URL ('') must also fall back to the placeholder —
// otherwise createDirectus('') resolves the API against the page origin (the apex site).
const DIRECTUS_URL =
  import.meta.env.PUBLIC_DIRECTUS_URL || 'https://admin.kingdom1516.example';

// The Directus Data Studio (the ready-made CMS admin) is served at /admin on the
// Directus origin — a DIFFERENT origin from the site's own apex /admin shell.
export const DATA_STUDIO_URL = `${DIRECTUS_URL}/admin`;

const client = createDirectus(DIRECTUS_URL)
  .with(authentication('session', { credentials: 'include' }))
  .with(rest({ credentials: 'include' }));

export function login(email: string, password: string) {
  return client.login({ email, password }, { mode: 'session' });
}

export function logout() {
  return client.logout({ mode: 'session' });
}

export function getCurrentUser() {
  return client.request(readMe({ fields: ['id', 'email', 'first_name', 'last_name'] }));
}

export async function isAuthenticated(): Promise<boolean> {
  try {
    await getCurrentUser();
    return true;
  } catch {
    return false;
  }
}

// The shell derives the role chip + which tabs to show from the two reads below; the
// real authorization is server-enforced by Directus — these only drive the UX gate.

// Per-collection access for the current user. Directus REST `GET /permissions/me`
// returns an object keyed by collection → action → { access: 'none'|'partial'|'full' }
// for every collection the user has ≥1 permission on. ⚠️ An Administrator BYPASSES
// permissions, so this returns few/no entries for the Owner — never infer Owner from
// here; use getAdminAccess() (admin_access) instead. The custom-request result shape
// is SDK-version-specific (raw body vs unwrapped) — callers must handle both.
export function getMyPermissions() {
  return client.request(() => ({ path: '/permissions/me', method: 'GET' }));
}

// Owner (Administrator) detection. Owner = the built-in Administrator whose policy
// carries `admin_access: true` (the universal-override flag). Verified against
// directus 12.0.2: `admin_access` is NOT a field on `directus_users` — it lives on the
// aggregated *policies*, reachable either directly on the user (`policies`) or via
// the role (`role.policies`). The Administrator returns
// `role.policies[].policy.admin_access === true`; a leader (or role-less user) returns
// none. `app_access` is deliberately NOT used as the Owner signal — Editors/Seniors/
// Officials also carry it. Reads defensively; returns false on any error.
export async function getAdminAccess(): Promise<boolean> {
  type PolicyLink = { policy?: { admin_access?: boolean } | null } | null;
  try {
    const me = (await client.request(
      readMe({
        fields: ['policies.policy.admin_access', 'role.policies.policy.admin_access'],
      } as Parameters<typeof readMe>[0])
    )) as { policies?: PolicyLink[]; role?: { policies?: PolicyLink[] } | null };

    const links: PolicyLink[] = [
      ...(me.policies ?? []),
      ...(me.role?.policies ?? []),
    ];
    return links.some((l) => l?.policy?.admin_access === true);
  } catch {
    return false;
  }
}

/*
  Candidate PII is read at runtime over the session cookie — NEVER baked into static
  HTML. The `transfer-viewer` policy carries a free whole-collection read on
  `candidates` (fields:["*"], no filter — the only free shape on Core; a field subset
  or row filter is 403 RESOURCE_RESTRICTED), so a Viewer sees ALL fields of ALL rows;
  a leader without the grant / the Public get 403 server-side — the absent tab is only
  cosmetic.

  desired_alliance / suggested_alliance are M2O → alliances, deep-expanded {id, name}
  so names resolve LIVE at runtime with no rebuild. The whole-collection grant does let
  a Viewer read the `official` FK via the API, but that is only an opaque
  directus_users id — no user PII without a `directus_users` read grant, which Viewers
  do not have.
*/
export interface CandidateAlliance {
  id: number;
  name: string | null;
}
export interface Candidate {
  id: number;
  character_name: string;
  player_id: string;
  kingdom_number: number;
  timezone: string;
  who_invited: string;
  why_leaving: string;
  team_player_kvk: boolean;
  others_transferring: string;
  day4_fcfs: boolean;
  needs_special_invite: boolean;
  power: number | null; // raw units; null on rows from before the column existed
  current_alliance_tag: string | null; // no brackets stored; UI renders [tag]Name
  what_you_seek: string | null;
  players_to_avoid: string | null;
  status: string;
  planned_path: string | null;
  desired_alliance: CandidateAlliance | null;
  suggested_alliance: CandidateAlliance | null;
  group: number | null;
  period: number | null;
}

export function getCandidates() {
  return client.request(
    readItems('candidates', {
      fields: ['*', { desired_alliance: ['id', 'name'] }, { suggested_alliance: ['id', 'name'] }],
      limit: -1, // the working list is bounded (~58/window); no pagination
      sort: ['-id'],
    })
  ) as Promise<Candidate[]>;
}

/*
  The single active window's caps, read at RUNTIME on the SAME session client as
  getCandidates. Do NOT reuse the build-time reader in transfer-build.ts — that one
  authenticates with the static DIRECTUS_TOKEN for SSG baking; this is the live,
  cookie-authenticated shell read.

  Returns null when no window is active (0 rows) so the shell can degrade calmly ("No
  active transfer window") instead of throwing — a null denominator is a UX state
  here, not a build failure.
*/
export interface TransferPeriod {
  id: number;
  name: string;
  invited_cap: number | null;
  random_cap: number | null;
  special_cap: number | null;
  active: boolean;
  starts_on: string | null; // ISO date; null on windows from before the field existed
}

export async function getActivePeriod(): Promise<TransferPeriod | null> {
  const rows = (await client.request(
    readItems('transfer_period', {
      filter: { active: { _eq: true } },
      fields: ['*'],
      limit: 1,
      sort: ['-id'], // deterministic pick if the "exactly one active" invariant is ever violated
    })
  )) as TransferPeriod[];
  return rows[0] ?? null;
}

export function getPeriods() {
  return client.request(
    readItems('transfer_period', { fields: ['id', 'name', 'active', 'starts_on'], limit: -1, sort: ['-id'] })
  ) as Promise<Pick<TransferPeriod, 'id' | 'name' | 'active' | 'starts_on'>[]>;
}

/*
  ⚠️ Enforcement reality (Core tier): the `transfer-curator` update grant is a FREE
  whole-collection `fields:["*"]` (a field-subset/row-filter/validation is 403
  RESOURCE_RESTRICTED). The SERVER enforces only WHO may write (Curator: 200; Viewer:
  403); the transition ORDER is UI-guided only. The field boundary is convention, NOT
  server-enforced: callers MUST send only { status } and/or { planned_path } — NEVER
  `period` (a re-stamp is silent carry-over corruption), never the public-core /
  desired_alliance fields.
*/
export type CandidatePatch = {
  status?: string;
  planned_path?: string | null;
  suggested_alliance?: number | null; // M2O id (write side); read side is the expanded {id,name}
  group?: number | null; // M2O id → transfer_groups (write side); read side is the raw id
};

export function updateCandidate(id: number, patch: CandidatePatch) {
  return client.request(updateItem('candidates', id, patch)) as Promise<Candidate>;
}

/*
  updateCandidates() is the ATOMIC group-level fan-out: one PATCH /items/candidates
  with { keys, data } sets every member's suggested_alliance to the SAME value in a
  single server-side transaction — NOT a loop of N single-row PATCHes (which could
  half-fan-out and leave a group flagged forever).

  ⚠️ Same discipline as updateCandidate: callers send ONLY { suggested_alliance }
  and/or { group } — never `period`, never the public-core / desired_alliance fields;
  the field boundary is UI convention, not server-enforced on Core.
*/
export function updateCandidates(ids: number[], patch: CandidatePatch) {
  return client.request(updateItems('candidates', ids, patch)) as Promise<Candidate[]>;
}

// name stays null — groups are labelled by their membership. The Curator holds
// transfer_groups READ, so the create echoes the new row incl. its id — the linking
// flow needs that id to stamp candidates.group.
export function createGroup() {
  return client.request(createItem('transfer_groups', { name: null })) as Promise<{ id: number }>;
}

// Dissolve a transfer group once it drops below 2 members (a "group of one" is not a group).
// on_delete: SET NULL on candidates.group means any lingering member is un-linked, not deleted.
export function deleteGroup(id: number) {
  return client.request(deleteItem('transfer_groups', id));
}

/*
  ⚠️ Enforcement (Core tier): the `transfer-curator` policy carries a FREE
  whole-collection `candidates` delete grant — `delete` has no field/row/validation
  axis, so this is the only shape. The SERVER enforces WHO may delete (Curator 204 /
  Viewer 403 / anon 403 / Owner admin-bypass 204); the UI also hides the control, but
  the gate is the grant's absence. Candidates is a schema LEAF (nothing references a
  candidates row; membership lives only on candidates.group), so a hard delete leaves
  no FK orphan. A delete that drops a transfer group below 2 members is dissolved in
  the shell.
*/
export function deleteCandidate(id: number) {
  return client.request(deleteItem('candidates', id));
}

// The between-windows cleanup batch: delete every terminal row in ONE transaction —
// not an N-loop that could half-delete. Callers pass ONLY Transferred/Rejected ids;
// Accepted rows are never included.
export function deleteCandidates(ids: number[]) {
  return client.request(deleteItems('candidates', ids));
}

export interface AllianceOption {
  id: number;
  name: string | null;
}

export function getAlliances() {
  return client.request(
    readItems('alliances', { fields: ['id', 'name'], limit: -1, sort: ['name'] })
  ) as Promise<AllianceOption[]>;
}

// Presentation only — editing stays in the Data Studio. No `official` expansion:
// non-admin readers hold no directus_users grant.
export interface AllianceOverview {
  id: number;
  name: string;
  slug: string;
  bear_trap_1: string | null;
  bear_trap_2: string | null;
  peak: string | null;
  farm_alliance: string | null;
}
export function getAllianceOverview() {
  return client.request(
    readItems('alliances', {
      fields: ['id', 'name', 'slug', 'bear_trap_1', 'bear_trap_2', 'peak', 'farm_alliance'],
      limit: -1,
      sort: ['name'],
    })
  ) as Promise<AllianceOverview[]>;
}

// Owner-only (the Accounts tab is ownerOnly; only an admin session can read /users).
export interface AccountOverview {
  id: string;
  first_name: string | null;
  email: string | null;
  last_access: string | null;
  role: { name: string } | null;
  policies: { policy: { name: string; app_access: boolean; admin_access: boolean } | null }[] | null;
}
export function getAccountsOverview() {
  return client.request(
    readUsers({
      fields: ['id', 'first_name', 'email', 'last_access', { role: ['name'] }, { policies: [{ policy: ['name', 'app_access', 'admin_access'] }] }],
      limit: -1,
      sort: ['first_name'],
    })
  ) as Promise<AccountOverview[]>;
}

/*
  "Publish" = materialize a `guides` row (the public-build source) from a
  `guide_drafts` row (the Editor working copy), the two collections joined ONLY by the
  immutable slug — no relation, no status field.

  ⚠️ The server enforces only WHO may write `guides` (a Senior gets 200, an
  Editor/Viewer a real 403). WHAT gets copied is this helper's discipline:
  publishGuide() copies title/slug/body/category/creator_credit VERBATIM from the
  draft, sends `slug` only on CREATE (the row is found by slug on update — the publish
  path can never drift a published URL), and never sends the system date fields.
  Copying in code is what guarantees guide_drafts.slug == guides.slug (preview URL ==
  public URL, no link-rot). `body` is copied AS-IS; sanitization is the public
  reader's job — the admin shell never renders body HTML.
*/
export interface GuideCategory {
  id: number;
  name: string | null;
}
// List shape — deliberately WITHOUT body: the panel never renders body HTML, and the
// publish path re-reads the draft fresh at click time, so the load-once list needn't
// ship every draft's HTML to every leader.
export interface GuideDraft {
  id: number;
  title: string;
  slug: string;
  category: GuideCategory | null;
  creator_credit: string | null;
  date_created: string | null;
  date_updated: string | null;
}
export interface GuideDraftFull extends GuideDraft {
  body: string | null;
}
// The published side needs only the join key + timestamps (for the derived state chip) —
// the list never renders published content; the id is the update target on re-publish.
export interface PublishedGuide {
  id: number;
  slug: string;
  date_created: string | null;
  date_updated: string | null;
}

export function getGuideDrafts() {
  return client.request(
    readItems('guide_drafts', {
      fields: ['id', 'title', 'slug', { category: ['id', 'name'] }, 'creator_credit', 'date_created', 'date_updated'],
      limit: -1, // a kingdom KB is small (tens of guides); no pagination
      sort: ['-id'],
    })
  ) as Promise<GuideDraft[]>;
}

// Fresh single-draft read for the publish path: the panel list is load-once, but the
// copy must never publish a stale body — an Editor may have saved in the Studio after
// the Senior's panel loaded. Fetched at click time, body included.
export function getGuideDraft(id: number) {
  return client.request(
    readItem('guide_drafts', id, {
      fields: ['id', 'title', 'slug', 'body', { category: ['id', 'name'] }, 'creator_credit', 'date_created', 'date_updated'],
    })
  ) as Promise<GuideDraftFull>;
}

export function getPublishedGuides() {
  return client.request(
    readItems('guides', {
      fields: ['id', 'slug', 'date_created', 'date_updated'],
      limit: -1,
    })
  ) as Promise<PublishedGuide[]>;
}

// Publish (create) or re-publish (update) a draft into `guides`. Pass existingGuideId when
// a `guides` row with the draft's slug already exists — found by the CALLER over its
// in-memory published list, so the create-vs-update branch is unit-testable in isolation.
export function publishGuide(draft: GuideDraftFull, existingGuideId?: number) {
  const copy = {
    title: draft.title,
    body: draft.body,
    category: draft.category?.id ?? null, // M2O write side is the id
    creator_credit: draft.creator_credit,
  };
  if (existingGuideId != null) {
    return client.request(updateItem('guides', existingGuideId, copy)) as Promise<PublishedGuide>;
  }
  return client.request(
    createItem('guides', { ...copy, slug: draft.slug })
  ) as Promise<PublishedGuide>;
}
