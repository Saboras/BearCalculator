import {
  fetchGuidesRaw,
  fetchCategoriesRaw,
  isDirectusConfigured,
  type DirectusGuideRow,
  type DirectusCategoryRow,
} from '../lib/guides-build';
import { sanitizeGuideBody } from '../lib/sanitize-guide';

/*
  Build-time Guides data layer (Story 6.4). Runs exclusively in Astro SSG
  frontmatter / endpoints via top-level await.

  - Source toggle: no build token → the KB builds EMPTY (deliberately no seed
    file — committed guide content would rot; the pages render calm empty
    states, AC6/NFR-2) with a console.warn. Token configured → live Directus
    read; a fetch error PROPAGATES so `astro build` fails loud (never ship a
    silently-empty KB that looks like the legitimate zero-guides state).
  - Boundary validation: the network read is a system boundary — malformed rows
    fail the build loudly instead of rendering wrong. An empty array is VALID.
  - Sanitization: `body` is sanitized HERE, once, centrally — no consumer of
    this module ever sees raw WYSIWYG HTML (the §18.2 MUST). Image
    localization happens later, per page, in guide-images.ts.
*/

export interface GuideCategory {
  id: number;
  name: string;
  slug: string;
  sort: number | null;
}

export interface Guide {
  title: string;
  slug: string;
  /** Sanitized HTML — safe to render after image localization. */
  body: string;
  category: GuideCategory | null;
  creator_credit: string | null;
  /** ISO timestamp of the last content change (date_updated ?? date_created). */
  updated: string | null;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fail(msg: string): never {
  throw new Error(
    `guides data is invalid — ${msg}. Fix the source (the Directus guides/categories collections) and rebuild.`
  );
}

function isStringOrNull(v: unknown): boolean {
  return v === null || typeof v === 'string';
}

function validateCategoryShape(c: unknown, at: string): void {
  if (typeof c !== 'object' || c === null || Array.isArray(c)) fail(`${at} is not an object`);
  const r = c as Record<string, unknown>;
  if (typeof r.id !== 'number') fail(`${at} "id" must be a number`);
  if (typeof r.name !== 'string' || r.name.trim() === '') fail(`${at} "name" must be a non-empty string`);
  if (typeof r.slug !== 'string' || !SLUG_RE.test(r.slug)) fail(`${at} "slug" must be kebab-case (got ${JSON.stringify(r.slug)})`);
  if (r.sort !== null && typeof r.sort !== 'number') fail(`${at} "sort" must be a number or null`);
}

export function validateCategories(data: unknown): DirectusCategoryRow[] {
  if (!Array.isArray(data)) fail('categories: the top-level value is not an array');
  const seen = new Set<string>();
  data.forEach((row, i) => {
    validateCategoryShape(row, `category row ${i}`);
    const slug = (row as DirectusCategoryRow).slug;
    if (seen.has(slug)) fail(`duplicate category slug "${slug}"`);
    seen.add(slug);
  });
  return data as DirectusCategoryRow[];
}

export function validateGuides(data: unknown): DirectusGuideRow[] {
  if (!Array.isArray(data)) fail('guides: the top-level value is not an array');
  const seen = new Set<string>();
  data.forEach((row, i) => {
    const at = `guide row ${i}`;
    if (typeof row !== 'object' || row === null || Array.isArray(row)) fail(`${at} is not an object`);
    const r = row as Record<string, unknown>;
    if (typeof r.title !== 'string' || r.title.trim() === '') fail(`${at} "title" must be a non-empty string`);
    if (typeof r.slug !== 'string' || !SLUG_RE.test(r.slug)) fail(`${at} "slug" must be kebab-case (got ${JSON.stringify(r.slug)})`);
    if (seen.has(r.slug)) fail(`duplicate guide slug "${r.slug}"`);
    seen.add(r.slug as string);
    if (!isStringOrNull(r.body)) fail(`${at} "body" must be a string or null`);
    if (r.category !== null) validateCategoryShape(r.category, `${at} "category"`);
    if (!isStringOrNull(r.creator_credit)) fail(`${at} "creator_credit" must be a string or null`);
    if (!isStringOrNull(r.date_created)) fail(`${at} "date_created" must be a string or null`);
    if (!isStringOrNull(r.date_updated)) fail(`${at} "date_updated" must be a string or null`);
  });
  return data as DirectusGuideRow[];
}

function mapGuide(r: DirectusGuideRow): Guide {
  return {
    title: r.title,
    slug: r.slug,
    body: sanitizeGuideBody(r.body),
    category: r.category
      ? { id: r.category.id, name: r.category.name, slug: r.category.slug, sort: r.category.sort ?? null }
      : null,
    creator_credit: r.creator_credit ?? null,
    updated: r.date_updated ?? r.date_created ?? null,
  };
}

/** Newest content first — the card order within a category. */
export function sortGuides(list: Guide[]): Guide[] {
  return [...list].sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
}

/** Manual KB order (categories.sort), nulls last, then name. */
export function sortCategories(list: GuideCategory[]): GuideCategory[] {
  return [...list].sort(
    (a, b) => (a.sort ?? Number.MAX_SAFE_INTEGER) - (b.sort ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name)
  );
}

async function loadKb(): Promise<{ guides: Guide[]; categories: GuideCategory[] }> {
  if (!isDirectusConfigured()) {
    console.warn(
      '[guides] DIRECTUS_TOKEN not set — building an EMPTY Guides section (no seed exists by design). Set a read token to source live Directus data.'
    );
    return { guides: [], categories: [] };
  }
  const [guideRows, categoryRows] = await Promise.all([fetchGuidesRaw(), fetchCategoriesRaw()]);
  console.log(
    `[guides] Sourced ${guideRows.length} guide(s) in ${categoryRows.length} categor(ies) from Directus at build time.`
  );
  return {
    guides: sortGuides(validateGuides(guideRows).map(mapGuide)),
    categories: sortCategories(validateCategories(categoryRows)),
  };
}

const kb = await loadKb();
export const guides: Guide[] = kb.guides;
export const categories: GuideCategory[] = kb.categories;

/** Guides without a category (M2O SET NULL) — surfaced on the KB root, never dropped. */
export const uncategorizedGuides: Guide[] = guides.filter((g) => g.category === null);

export function guidesInCategory(categorySlug: string): Guide[] {
  return guides.filter((g) => g.category?.slug === categorySlug);
}
