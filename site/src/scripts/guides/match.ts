/*
  Pure search matcher (Story 6.4) — separated from the DOM wiring so it is
  unit-testable in isolation (the scripts/finder/ranking.ts pattern).
  Case-insensitive substring match over title + category + excerpt; a
  hand-rolled filter is deliberate — at tens-of-guides scale a search library
  would be a dependency for nothing (the AR-18 contract binds the artifact
  path + one-build-step, not a library).
*/
export interface GuideIndexEntry {
  title: string;
  slug: string;
  category: string | null;
  excerpt: string;
}

export const MIN_QUERY_LENGTH = 2;

export function matchGuides(query: string, index: GuideIndexEntry[]): GuideIndexEntry[] {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY_LENGTH) return [];
  return index.filter(
    (e) =>
      e.title.toLowerCase().includes(q) ||
      (e.category ?? '').toLowerCase().includes(q) ||
      e.excerpt.toLowerCase().includes(q)
  );
}
