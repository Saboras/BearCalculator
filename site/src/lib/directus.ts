import { createDirectus, authentication, rest, readMe } from '@directus/sdk';

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
