import { guides } from '../data/guides';
import { stripToExcerpt } from '../lib/sanitize-guide';

/*
  The client-side search index (Story 6.4, AC4 / AR-18): a static JSON artifact
  emitted at the FIXED path /guides-index.json by this endpoint during
  `astro build`. Generator (this file) and reader (src/scripts/guides/search.ts,
  bundled into the /guides page) ship from the SAME build step, so the format
  can never split from its consumer. No server search endpoint exists or is
  needed. Excerpts come from the SANITIZED body (the index must not become a
  second unsanitized sink) with tags stripped.
*/
export function GET() {
  const index = guides.map((g) => ({
    title: g.title,
    slug: g.slug,
    category: g.category?.name ?? null,
    excerpt: stripToExcerpt(g.body),
  }));
  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json' },
  });
}
