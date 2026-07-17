import { createDirectus, staticToken, rest, readItems } from '@directus/sdk';

/*
  Build-time-only Directus read client for the Guides KB (Story 6.4).

  SEPARATE from src/lib/directus.ts on purpose, for the same reason as
  directus-build.ts (Story 4.3): directus.ts is bundled into browser JS (the
  /leader + /admin session auth), so a read token referenced there could be
  inlined into that bundle by Vite. This module is imported only by build-time
  code (src/data/guides.ts, the guide pages' frontmatter, the search-index
  endpoint), so the token never reaches a client bundle.

  The token is read from process.env, NOT import.meta.env — a non-PUBLIC_
  variable is a Node process var in Astro v6, and process.env is leak-safe: if
  this module were ever pulled client-side by mistake, process.env.* is
  undefined in the browser rather than inlining the secret.

  The build reads the `guides` collection ONLY — published = a row exists in
  `guides` (Option 2, roles-and-policies §0). `guide_drafts` has no grant on
  the build policy and must never be read here (a build-token GET on it is a
  live-proven 403).
*/

const DIRECTUS_URL_PLACEHOLDER = 'https://admin.kingdom1516.example';
// Trailing slashes trimmed so a "https://host/" config never yields
// "host//assets/…" fetch URLs (directusFileId and assetFetchUrl stay in sync).
export const DIRECTUS_URL = (import.meta.env.PUBLIC_DIRECTUS_URL || DIRECTUS_URL_PLACEHOLDER).replace(
  /\/+$/,
  ''
);
// Trim so a stray trailing space/newline is not treated as "configured".
const DIRECTUS_TOKEN = (process.env.DIRECTUS_TOKEN ?? '').trim();

// Matches the obviously-fake default in site/.env.example — treated as "unset".
const TOKEN_PLACEHOLDER = 'REPLACE_WITH_READ_ONLY_BUILD_TOKEN';

/*
  True only when a real read token is configured. When false, the KB builds
  EMPTY (there is deliberately no guides seed file — committed guide content
  would rot; the /guides pages render their calm empty states instead), so CI
  and local builds stay green before the VPS + token exist.
*/
export function isDirectusConfigured(): boolean {
  return DIRECTUS_TOKEN !== '' && DIRECTUS_TOKEN !== TOKEN_PLACEHOLDER;
}

/*
  Build-time fetch URL for a Directus-stored original asset. Assets are NOT
  publicly readable (live-measured 6.4: anon and no-files-grant tokens both
  403), so the build authenticates with the same read token via Directus'
  access_token query parameter — Astro's image pipeline fetches with a plain
  GET and cannot send headers. The token appears only in this build-time URL;
  the emitted asset is a local hashed file and the URL never reaches dist/
  (the token-leak grep proves it every build).
*/
export function assetFetchUrl(fileId: string): string {
  return `${DIRECTUS_URL}/assets/${fileId}?access_token=${DIRECTUS_TOKEN}`;
}

export interface DirectusGuideCategoryRef {
  id: number;
  name: string;
  slug: string;
  sort: number | null;
}

export interface DirectusGuideRow {
  id: number;
  title: string;
  slug: string;
  body: string | null;
  category: DirectusGuideCategoryRef | null;
  creator_credit: string | null;
  date_created: string | null;
  date_updated: string | null;
}

export interface DirectusCategoryRow {
  id: number;
  name: string;
  slug: string;
  sort: number | null;
}

/*
  Read every published guide / every category at build time. A network / auth /
  HTTP error REJECTS, and the caller must let it propagate so `astro build`
  fails loud rather than shipping a stale or empty KB — a failed fetch must
  never masquerade as the legitimate zero-guides state. limit: -1 = all rows.
*/
function buildClient() {
  if (DIRECTUS_URL === DIRECTUS_URL_PLACEHOLDER) {
    throw new Error(
      'DIRECTUS_TOKEN is set but PUBLIC_DIRECTUS_URL is not — set the live Directus base URL (see site/.env.example) so the build reads from the real host, not the placeholder.'
    );
  }
  return createDirectus(DIRECTUS_URL).with(staticToken(DIRECTUS_TOKEN)).with(rest());
}

export async function fetchGuidesRaw(): Promise<DirectusGuideRow[]> {
  const rows = await buildClient().request(
    readItems('guides', {
      fields: [
        'id',
        'title',
        'slug',
        'body',
        { category: ['id', 'name', 'slug', 'sort'] },
        'creator_credit',
        'date_created',
        'date_updated',
      ],
      limit: -1,
      sort: ['-id'],
    })
  );
  return rows as DirectusGuideRow[];
}

export async function fetchCategoriesRaw(): Promise<DirectusCategoryRow[]> {
  const rows = await buildClient().request(
    readItems('categories', { fields: ['id', 'name', 'slug', 'sort'], limit: -1, sort: ['sort'] })
  );
  return rows as DirectusCategoryRow[];
}
