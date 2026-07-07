import alliancesData from './alliances.json';
import { fetchAlliancesRaw, isDirectusConfigured, type DirectusAllianceRow } from '../lib/directus-build';

/*
  The Alliance type lives here, with its data. 7 canonical fields (AD-18); the
  same flat shape both phases. Times are "HH:MM" UTC times-of-day (no date), peak
  is a single scalar (never a range), and every time field is nullable (AD-10).

  Source (Story 4.3): the Finder now sources this array from the Directus
  `alliances` collection at BUILD time (SSG) when a read token is configured;
  otherwise it falls back to the committed ./alliances.json seed (see the toggle
  at the bottom). The exported shape is identical either way, so finder.astro,
  AllianceCard, and the finder client script are unchanged (AR-16 / AR-17).
*/
export interface Alliance {
  name: string;
  slug: string;
  bear_trap_1: string | null;
  bear_trap_2: string | null;
  peak: string | null;
  farm_alliance: string | null;
  official: string | null;
}

/*
  Build-time validation (AC6). A malformed time, a duplicate slug, or a non-canonical
  row must fail `npm run build` loudly instead of rendering wrong. A thrown error here
  fails the build (this module is evaluated during static rendering).

  Story 4.3 keeps this gate ON the Directus-sourced rows: the network read is now a
  system boundary, so the validator is the boundary guard (mapped rows are fed through
  it exactly like the seed file). It runs AFTER mapRow(), which normalizes Directus
  time serialization to HH:MM, so TIME_RE stays strict HH:MM by design.
*/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // kebab-case; "516" (kebab-of-digits) is valid
const CANONICAL_KEYS = ['name', 'slug', 'bear_trap_1', 'bear_trap_2', 'peak', 'farm_alliance', 'official'];

function fail(msg: string): never {
  throw new Error(
    `alliances data is invalid — ${msg}. Fix the source (the Directus alliances collection, or the src/data/alliances.json seed) and rebuild.`
  );
}
function isTimeOrNull(v: unknown): boolean {
  return v === null || (typeof v === 'string' && TIME_RE.test(v));
}
function isStringOrNull(v: unknown): boolean {
  return v === null || typeof v === 'string';
}
function validateAlliances(data: unknown): Alliance[] {
  if (!Array.isArray(data)) fail('the top-level value is not an array');
  const seen = new Set<string>();
  data.forEach((row: unknown, i: number) => {
    const at = `row ${i}`;
    if (typeof row !== 'object' || row === null || Array.isArray(row)) fail(`${at} is not an object`);
    const r = row as Record<string, unknown>;
    const keys = Object.keys(r);
    if (keys.length !== CANONICAL_KEYS.length || !CANONICAL_KEYS.every((k) => k in r)) {
      fail(`${at} must have exactly the 7 canonical keys [${CANONICAL_KEYS.join(', ')}] (got [${keys.join(', ')}])`);
    }
    if (typeof r.name !== 'string' || r.name.trim() === '') fail(`${at} "name" must be a non-empty string`);
    if (typeof r.slug !== 'string' || r.slug.trim() === '') fail(`${at} "slug" must be a non-empty string`);
    if (!SLUG_RE.test(r.slug)) fail(`${at} "slug" must be kebab-case (got "${r.slug}")`);
    if (seen.has(r.slug)) fail(`duplicate slug "${r.slug}"`);
    seen.add(r.slug);
    if (!isTimeOrNull(r.bear_trap_1)) fail(`${at} "bear_trap_1" must be null or "HH:MM" (got ${JSON.stringify(r.bear_trap_1)})`);
    if (!isTimeOrNull(r.bear_trap_2)) fail(`${at} "bear_trap_2" must be null or "HH:MM" (got ${JSON.stringify(r.bear_trap_2)})`);
    if (!isTimeOrNull(r.peak)) fail(`${at} "peak" must be null or "HH:MM" (got ${JSON.stringify(r.peak)})`);
    if (!isStringOrNull(r.farm_alliance)) fail(`${at} "farm_alliance" must be a string or null`);
    if (!isStringOrNull(r.official)) fail(`${at} "official" must be a string or null`);
  });
  // An empty array is a VALID state (Story 2.3 renders zero gracefully) — never a build error.
  return data as Alliance[];
}

/*
  Map a Directus row to the flat 7-key Alliance shape.
  - Directus `time` fields serialize as HH:MM:SS for Studio-edited rows (the datetime
    interface stores seconds); the Finder validator + renderer expect HH:MM, so
    truncate to the first 5 chars. Seed-imported rows already read back as HH:MM.
  - `official` is a directus_users M2O (PII) and is not selected by the read — keep it
    null (the Finder never renders it; it only exists to satisfy the canonical shape).
  - slug/name stay strings; "516" is never number-coerced (AR-18).
*/
function normalizeTime(v: string | null): string | null {
  return typeof v === 'string' && v.length > 5 ? v.slice(0, 5) : v;
}
function mapRow(r: DirectusAllianceRow): Alliance {
  return {
    name: r.name,
    slug: r.slug,
    bear_trap_1: normalizeTime(r.bear_trap_1),
    bear_trap_2: normalizeTime(r.bear_trap_2),
    peak: normalizeTime(r.peak),
    farm_alliance: r.farm_alliance ?? null,
    official: null,
  };
}

/*
  Source toggle (Story 4.3).
  - No build token configured → build from the committed seed file. Keeps CI and local
    builds green before the VPS + token exist (MVP-1 behaviour, byte-for-byte unchanged).
  - Token configured → source from Directus at build time (SSG, AC1). A fetch error
    PROPAGATES so `astro build` fails loud; it must never be swallowed into an empty
    Finder that looks like the legitimate empty-collection zero-state.
*/
async function loadAlliances(): Promise<Alliance[]> {
  if (!isDirectusConfigured()) {
    console.warn(
      '[alliances] DIRECTUS_TOKEN not set — building the Finder from the static seed (src/data/alliances.json). Set a read token to source live Directus data.'
    );
    return validateAlliances(alliancesData);
  }
  const rows = await fetchAlliancesRaw();
  console.log(`[alliances] Sourced ${rows.length} alliance(s) from Directus at build time.`);
  return validateAlliances(rows.map(mapRow));
}

export const alliances: Alliance[] = await loadAlliances();
