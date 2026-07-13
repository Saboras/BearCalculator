import {
  createDirectus,
  authentication,
  rest,
  readMe,
  readItems,
  updateItem,
  updateItems,
  createItem,
  deleteItem,
} from '@directus/sdk';

/*
  Directus client — leader session auth for the /leader gate (Story 3.2).

  Session-cookie mode is deliberate and security-load-bearing:
  `login({ mode: 'session' })` makes Directus set the httpOnly `directus_session_token`
  cookie and returns NO token in the body. `credentials: 'include'` on both composables
  is what sends/receives that cookie cross-subdomain (apex site ↔ admin subdomain).
  The credential therefore lives only in a browser-managed httpOnly cookie, never in JS
  or localStorage — the XSS defense required by AR-18 / NFR-D. Never switch to
  `mode: 'json'` (that returns access_token in the body → would have to be stored).
*/
// `||` not `??`: an empty PUBLIC_DIRECTUS_URL ('') must also fall back to the placeholder —
// otherwise createDirectus('') resolves the API against the page origin (the apex site).
const DIRECTUS_URL =
  import.meta.env.PUBLIC_DIRECTUS_URL || 'https://admin.kingdom1516.example';

// The Directus Data Studio (the ready-made CMS admin) is served at /admin on the
// Directus origin — a DIFFERENT origin from the site's own apex /admin shell. The
// admin-shell's Guides/Alliances/Accounts tabs hand off here (AR-5 / NFR-18).
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

/*
  --- Admin-shell reads (Story 3.5) ---
  Both are client-side, session-cookie authenticated. The shell derives the role
  chip + which tabs to show from these; the real authorization is still
  server-enforced by Directus (AD-4) — these reads only drive the UX gate.
*/

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
// carries `admin_access: true` (the universal-override flag, AD-9/AR-11). Verified
// against directus 12.0.2: `admin_access` is NOT a field on `directus_users` — it lives
// on the aggregated *policies*, reachable either directly on the user (`policies`) or via
// the role (`role.policies`). The Administrator returns
// `role.policies[].policy.admin_access === true`; a leader (or role-less user) returns
// none. `app_access` is deliberately NOT used as the Owner signal — Editors/Seniors/
// Officials also carry it (3.4 review). Reads defensively; returns false on any error.
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
  --- Candidate list read (Story 5.4) ---
  The transfer candidate list — the FIRST feature that reads authenticated candidate
  PII and renders it. Runtime, client-side, session-cookie authenticated (AD-2/AR-4):
  candidate data is NEVER baked into static HTML. The `transfer-viewer` policy carries a
  free whole-collection read on `candidates` (fields:["*"], no filter — the only free
  shape on Core; a field subset or row filter is 🔒 403 RESOURCE_RESTRICTED), so a Viewer
  sees ALL fields of ALL rows (transparency-by-design). A leader without the grant / the
  Public get 403 server-side (AD-4/NFR-9) — the absent tab is only cosmetic.

  desired_alliance / suggested_alliance are M2O → alliances; we deep-expand {id, name}
  (Option B, Sabo 2026-07-09) so names resolve LIVE at runtime with no rebuild — this
  needs the free whole-collection `alliances` read on the same policy. id is kept for the
  divergent-group edge computation; the list QUERY expands only id+name, so the candidate
  list never SURFACES `official`. Note the whole-collection grant itself (forced by Core — a
  field subset is 🔒) does let a Viewer READ the `official` FK directly via the API, but that
  is only an opaque directus_users id — no user PII without a `directus_users` read grant,
  which Viewers do not have.
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
      limit: -1, // the working list is bounded (~58/window); no pagination/infinite scroll (AC4)
      sort: ['-id'], // newest first; active-window scoping + carry-over ordering is Story 5.7
    })
  ) as Promise<Candidate[]>;
}

/*
  --- Active transfer period read (Story 5.7) ---
  The single active window's caps, read at RUNTIME on the SAME session client as
  getCandidates (httpOnly cookie, credentials:'include'). The 5.7 counter denominators
  (invited_cap / special_cap) + the active-window scoping + the carry-over derivation all
  key off this row's id and its live caps — never a stored counter, never build-baked.

  The runtime read grant ALREADY exists: `transfer_period read ["*"]` is wired for
  transfer-viewer (Story 5.4) and transfer-curator (Story 5.5), so no new grant. Do NOT
  reuse the build-time reader in transfer-build.ts — that one authenticates with the static
  DIRECTUS_TOKEN for SSG baking; this is the live, cookie-authenticated shell read.

  Returns null when no window is active (0 rows) so the shell can degrade calmly ("No
  active transfer window") instead of throwing — a null denominator is a UX state here, not
  a build failure (the build-time throw in transfer-build.ts is not appropriate at runtime).
*/
export interface TransferPeriod {
  id: number;
  name: string;
  invited_cap: number | null;
  random_cap: number | null;
  special_cap: number | null;
  active: boolean;
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

/*
  --- Curator candidate write (Story 5.5) ---
  The FIRST Curator WRITE from the admin shell: advance status (Applied → Accepted →
  Transferred / Rejected, plus the Random exception Applied → Transferred) and set
  planned_path on Accept. Same session client, same httpOnly cookie (credentials:'include')
  — the write authenticates automatically. The list stays LIVE: after a write the shell
  re-renders the row in place, no rebuild.

  ⚠️ Enforcement reality (Option 3, Core tier): the `transfer-curator` update grant is a
  FREE whole-collection `fields:["*"]` (a field-subset/row-filter/validation is 🔒 403
  RESOURCE_RESTRICTED). So the SERVER enforces only WHO may write (Curator: 200; Viewer:
  403 — deny-by-default); the transition ORDER is UI-guided only (AR-9/AD-7 — no Directus
  Flow/hook). The field boundary is convention, NOT server-enforced: callers MUST send only
  { status } and/or { planned_path } — NEVER `period` (a re-stamp is silent carry-over
  corruption, AD-17), never the public-core / desired_alliance fields (AD-8/AD-9).
  Returns the echoed row (the Curator holds the read grant) — used only to confirm success;
  the caller applies the patch it sent to its local row.
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
  --- Curator grouping + suggested-alliance writes (Story 5.6) ---
  The remaining two Curator row actions: LINK a friend-group and set a SUGGESTED alliance
  (a recommendation, never a placement — AD-8). Same session client, same httpOnly cookie.

  updateCandidates() is the ATOMIC group-level fan-out (AC3): one PATCH /items/candidates
  with { keys, data } sets every member's suggested_alliance to the SAME value in a single
  server-side transaction — NOT a loop of N single-row PATCHes (which could half-fan-out and
  leave a group flagged forever). Member ids come from the in-memory rows (rows.filter(group
  === gid)); no transfer_groups read is needed for the fan-out or the divergent flag.

  Grouping membership lives on candidates.group (M2O → transfer_groups). "Set at group level"
  writes each member's candidates.suggested_alliance; transfer_groups carries NO suggested
  column (AR-10). The divergent flag is edge-computed, never stored (AR-6).

  ⚠️ Same Option-3 discipline as 5.5: callers send ONLY { suggested_alliance } and/or
  { group } — never `period`, never the public-core / desired_alliance fields. The
  whole-collection Curator update grant (Story 5.5) already authorizes these fields; the
  field boundary is UI convention, not server-enforced on Core.
*/
export function updateCandidates(ids: number[], patch: CandidatePatch) {
  return client.request(updateItems('candidates', ids, patch)) as Promise<Candidate[]>;
}

// Mint a new (empty) transfer group. name stays null — groups are labelled by their
// membership (no name input in 5.6). The Curator holds transfer_groups READ, so the create
// echoes the new row incl. its id — the linking flow needs that id to stamp candidates.group.
export function createGroup() {
  return client.request(createItem('transfer_groups', { name: null })) as Promise<{ id: number }>;
}

// Dissolve a transfer group once it drops below 2 members (a "group of one" is not a group).
// on_delete: SET NULL on candidates.group means any lingering member is un-linked, not deleted.
export function deleteGroup(id: number) {
  return client.request(deleteItem('transfer_groups', id));
}

export interface AllianceOption {
  id: number;
  name: string | null;
}

// The suggested-alliance picker source. The Curator already holds a free whole-collection
// `alliances` read (Story 5.5), so no new grant is needed. id is the M2O write value; name
// renders in the picker + the Suggested cell.
export function getAlliances() {
  return client.request(
    readItems('alliances', { fields: ['id', 'name'], limit: -1, sort: ['name'] })
  ) as Promise<AllianceOption[]>;
}
