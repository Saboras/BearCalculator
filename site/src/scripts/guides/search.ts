/*
  Guide search — client wiring (Story 6.4, AC4). Pure computation over the
  build-emitted /guides-index.json (fetched lazily on first interaction — a
  browse-only member never pays for it); NO server search endpoint. Result
  rows are built with textContent/createElement exclusively — index strings
  never enter the DOM as HTML. The matcher itself lives in ./match (pure,
  unit-tested in isolation).
*/
import { matchGuides, MIN_QUERY_LENGTH, type GuideIndexEntry } from './match';

const input = document.getElementById('guide-search') as HTMLInputElement | null;
const status = document.getElementById('guide-search-status');
const results = document.getElementById('guide-search-results');

let index: GuideIndexEntry[] | null = null;
let loading: Promise<void> | null = null;
let failed = false;

function ensureIndex(): Promise<void> {
  if (index || failed) return Promise.resolve();
  if (!loading) {
    loading = fetch('/guides-index.json')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        // A 200 that isn't the expected array (proxy error page, truncated
        // deploy) must land in the calm failed state, not TypeError later.
        if (!Array.isArray(data)) throw new Error('guides index is not an array');
        index = data as GuideIndexEntry[];
      })
      .catch(() => {
        failed = true; // non-fatal: browsing still works, say so calmly
      });
  }
  return loading;
}

function render(query: string) {
  if (!input || !status || !results) return;
  const q = query.trim();

  if (q.length < MIN_QUERY_LENGTH) {
    status.hidden = true;
    results.hidden = true;
    results.textContent = '';
    return;
  }
  if (failed) {
    status.hidden = false;
    status.textContent = 'Search is unavailable right now — browse the categories below.';
    results.hidden = true;
    results.textContent = '';
    return;
  }
  if (!index) return; // still loading; the fetch completion re-renders

  const hits = matchGuides(q, index);
  results.textContent = '';
  if (hits.length === 0) {
    status.hidden = false;
    status.textContent = 'No guides match — browse the categories below.';
    results.hidden = true;
    return;
  }
  status.hidden = false;
  status.textContent = hits.length === 1 ? '1 guide matches' : `${hits.length} guides match`;
  for (const hit of hits) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `/guide/${hit.slug}/`;
    a.textContent = hit.title;
    if (hit.category) {
      const cat = document.createElement('span');
      cat.className = 'kb-result-cat';
      cat.textContent = hit.category;
      a.append(cat);
    }
    li.append(a);
    results.append(li);
  }
  results.hidden = false;
}

if (input) {
  input.addEventListener('focus', () => {
    ensureIndex();
  });
  input.addEventListener('input', () => {
    ensureIndex().then(() => render(input.value));
    render(input.value);
  });
}
