import { createDirectus, staticToken, rest, readItems } from '@directus/sdk';
import alliancesData from '../data/alliances.json';
import { isDirectusConfigured } from './directus-build';

/*
  Build-time-only reader for the public apply form (Story 5.2).

  SEPARATE from directus-build.ts (the Finder's reader) on purpose. The apply form
  needs two things the Finder's reader deliberately withholds:
    - the alliance NUMERIC id — to write candidates.desired_alliance, an M2O → alliances.id
    - the active transfer_period id — to stamp candidates.period (AD-17)
  The public POST is create-only with NO read, so the browser can resolve neither
  at runtime; both are baked here at build time (SSG), exactly like the Finder bakes
  alliance data in 4.3. Keeping this in its own module leaves the reviewed 4.3 Finder
  path (directus-build.ts / alliances.ts) byte-for-byte untouched — the Finder still
  addresses alliances by slug only (AR-18), and no internal id leaks into its output.

  Like directus-build.ts this runs ONLY at build time (imported from Astro
  frontmatter), so the read token never reaches a client bundle. The URL/token reads
  mirror directus-build.ts (the canonical copy) and are re-read locally rather than
  imported, so this story does not modify the fenced Finder module.
*/
const DIRECTUS_URL_PLACEHOLDER = 'https://admin.kingdom1516.example';
const DIRECTUS_URL = import.meta.env.PUBLIC_DIRECTUS_URL || DIRECTUS_URL_PLACEHOLDER;
const DIRECTUS_TOKEN = (process.env.DIRECTUS_TOKEN ?? '').trim();

export interface ApplyAlliance {
  // null in seed mode (the committed JSON seed carries no ids); a real id when
  // sourced from Directus — the form can only resolve desired_alliance when it has one.
  id: number | null;
  slug: string;
  name: string;
}

export interface ApplyFormData {
  alliances: ApplyAlliance[];
  // null in seed mode; the single active transfer_period id when configured.
  activePeriodId: number | null;
}

interface DirectusAllianceIdRow {
  id: number;
  slug: string;
  name: string;
}
interface DirectusPeriodRow {
  id: number;
}

/*
  Load the apply-form data at build time.
  - Configured (real token) → live Directus reads; a network / auth / HTTP error
    PROPAGATES so `astro build` fails loud rather than shipping a broken form. If
    the active-period read does not return exactly one row, THROW (a form that
    can't stamp a valid period must not build — README §10.5 preconditions).
  - Not configured (no / placeholder token) → seed fallback: options from the
    committed alliances.json (no ids, no active period) so CI + local builds stay
    green before the VPS + token exist. The form renders but cannot POST until a
    live Directus is configured — expected (no public users exist before launch).
*/
export async function loadApplyFormData(): Promise<ApplyFormData> {
  if (!isDirectusConfigured()) {
    console.warn(
      '[apply-form] DIRECTUS_TOKEN not set — building /join from the static seed (no alliance ids, no active period). The form is inert until a live Directus is configured.'
    );
    const alliances = (alliancesData as { slug: string; name: string }[]).map((a) => ({
      id: null,
      slug: a.slug,
      name: a.name,
    }));
    return { alliances, activePeriodId: null };
  }

  if (DIRECTUS_URL === DIRECTUS_URL_PLACEHOLDER) {
    throw new Error(
      'DIRECTUS_TOKEN is set but PUBLIC_DIRECTUS_URL is not — set the live Directus base URL (see site/.env.example) so the apply form reads real alliance ids + the active period, not the placeholder host.'
    );
  }

  const client = createDirectus(DIRECTUS_URL).with(staticToken(DIRECTUS_TOKEN)).with(rest());

  const allianceRows = (await client.request(
    readItems('alliances', { fields: ['id', 'slug', 'name'], limit: -1, sort: ['name'] })
  )) as DirectusAllianceIdRow[];

  // Whole-collection read (the build token's finder-build-read policy grants read
  // on transfer_period too — free on Core; a field subset would be 🔒 licensed).
  const periodRows = (await client.request(
    readItems('transfer_period', { fields: ['id'], filter: { active: { _eq: true } }, limit: 2 })
  )) as DirectusPeriodRow[];

  if (periodRows.length !== 1) {
    throw new Error(
      `Expected exactly one active transfer_period, found ${periodRows.length}. The apply form stamps candidates.period with the single active period (AD-17); fix the active flag in the Data Studio (README §10.5) and rebuild.`
    );
  }

  const alliances = allianceRows.map((r) => ({ id: r.id, slug: r.slug, name: r.name }));
  console.log(
    `[apply-form] Sourced ${alliances.length} alliance(s) + active period ${periodRows[0].id} from Directus at build time.`
  );
  return { alliances, activePeriodId: periodRows[0].id };
}
