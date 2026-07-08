import { createDirectus, staticToken, rest, readItems } from '@directus/sdk';

/*
  Build-time-only Directus read client (Story 4.3).

  SEPARATE from src/lib/directus.ts on purpose. directus.ts is imported by
  client-side scripts (the /leader + /admin session auth) and is bundled into
  browser JS, so a read token referenced there could be inlined into that bundle
  by Vite. This module is imported ONLY by src/data/alliances.ts, which runs
  exclusively at build time (Astro SSG frontmatter), so the token never reaches
  a client bundle. (AR-18: the build pulls published content with a read-only
  token; the leader session and the create-only public role are separate seams.)

  The token is read from process.env, NOT import.meta.env. In Astro v6 a
  non-PUBLIC_ variable is a Node process var (import.meta.env no longer carries
  it), and process.env is also leak-safe: if this module were ever pulled
  client-side by mistake, process.env.* is undefined in the browser rather than
  inlining the secret.
*/

const DIRECTUS_URL_PLACEHOLDER = 'https://admin.kingdom1516.example';
const DIRECTUS_URL = import.meta.env.PUBLIC_DIRECTUS_URL || DIRECTUS_URL_PLACEHOLDER;
// Trim so a stray trailing space/newline (a common secret-paste artifact) is not
// treated as "configured" — that would send a malformed Bearer and fail the build
// instead of falling back to the seed.
const DIRECTUS_TOKEN = (process.env.DIRECTUS_TOKEN ?? '').trim();

// Matches the obviously-fake default in site/.env.example — treated as "unset".
const TOKEN_PLACEHOLDER = 'REPLACE_WITH_READ_ONLY_BUILD_TOKEN';

/*
  True only when a real read token is configured. When false, the Finder builds
  from the committed seed file (src/data/alliances.json) so CI and local builds
  stay green before the VPS + token exist — the MVP-1 behaviour, unchanged.
*/
export function isDirectusConfigured(): boolean {
  return DIRECTUS_TOKEN !== '' && DIRECTUS_TOKEN !== TOKEN_PLACEHOLDER;
}

export interface DirectusAllianceRow {
  name: string;
  slug: string;
  bear_trap_1: string | null;
  bear_trap_2: string | null;
  peak: string | null;
  farm_alliance: string | null;
}

/*
  The 6 public scalar fields. `official` (M2O -> directus_users) is deliberately
  NOT selected: it is never rendered and would pull a user UUID (PII) into the
  static HTML. `id` is internal — public addressing is by slug (AR-18).
*/
const ALLIANCE_FIELDS = ['name', 'slug', 'bear_trap_1', 'bear_trap_2', 'peak', 'farm_alliance'];

/*
  Read every alliance row at build time. A network / auth / HTTP error REJECTS,
  and the caller must let it propagate so `astro build` fails loud rather than
  shipping a stale or empty Finder — a failed fetch must never masquerade as the
  legitimate empty-collection zero-state. limit: -1 returns all rows.
*/
export async function fetchAlliancesRaw(): Promise<DirectusAllianceRow[]> {
  if (DIRECTUS_URL === DIRECTUS_URL_PLACEHOLDER) {
    throw new Error(
      'DIRECTUS_TOKEN is set but PUBLIC_DIRECTUS_URL is not — set the live Directus base URL (see site/.env.example) so the build reads from the real host, not the placeholder.'
    );
  }
  const client = createDirectus(DIRECTUS_URL).with(staticToken(DIRECTUS_TOKEN)).with(rest());
  const rows = await client.request(
    readItems('alliances', { fields: ALLIANCE_FIELDS, limit: -1, sort: ['name'] })
  );
  return rows as DirectusAllianceRow[];
}
