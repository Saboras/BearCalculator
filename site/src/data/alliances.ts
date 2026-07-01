import alliancesData from './alliances.json';

/*
  The Alliance type lives here, with its data — NOT in src/lib/, which is reserved
  for MVP-2 Directus (Story 1.5 lock). 7 canonical fields (AD-18); the same flat
  shape both phases. Times are "HH:MM" UTC times-of-day (no date), peak is a single
  scalar (never a range), and every time field is nullable (AD-10).
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
  row must fail `npm run build` loudly instead of rendering wrong. This is the data
  file's consumer — Story 2.1 shipped it unchecked and handed the gate here.

  An explicit check (not a schema lib) is the KISS choice: this is trusted, static,
  hand-authored data, so the "use schema validation" convention — which targets
  untrusted runtime HTTP boundaries — does not apply. A thrown error here fails the
  build (this module is evaluated during static rendering).
*/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // kebab-case; "516" (kebab-of-digits) is valid
const CANONICAL_KEYS = ['name', 'slug', 'bear_trap_1', 'bear_trap_2', 'peak', 'farm_alliance', 'official'];

function fail(msg: string): never {
  throw new Error(`alliances.json is invalid — ${msg}. Fix site/src/data/alliances.json and rebuild.`);
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

export const alliances: Alliance[] = validateAlliances(alliancesData);
