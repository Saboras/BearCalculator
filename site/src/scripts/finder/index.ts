/*
  Alliance Finder — client-side timezone conversion + best-fit ranking (DOM wiring).

  AD-1/AD-2 say public content renders at build time with no runtime backend fetch.
  Timezone is per-visitor (unknowable at build), so ALL alliance data is embedded in
  the static HTML (data-* on each card) and we convert + rank it here in the browser
  — pure computation over data already in the page, NOT a network fetch. Same shape
  as the Bear Trap calculator (client JS, no network).

  The server renders honest UTC values labelled "· UTC"; this script rewrites them to
  the visitor's local time on load. The pure ranking maths lives in ./ranking.ts; this
  file owns everything that touches the DOM, localStorage, and event wiring.
*/

import {
  type PeakWin,
  type Bucket,
  DOTS,
  LABELS,
  RANK,
  localHours,
  toLocal,
  offsetLabel,
  bearTimesHTML,
  isValidTz,
  detectTz,
  scoreTraps,
} from './ranking';

const STORAGE_KEY = 'finder-tz';
// Personal peak windows (Story 2.5): the visitor's own declared local active
// times. PEAK_KEY mirrors STORAGE_KEY's persistence; HHMM_RE re-validates a
// hand-edited/corrupt stored value so it can never brick the page.
const PEAK_KEY = 'finder-peak';
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Declared windows currently in effect. Empty → the page ranks against the 20:30
// evening centre exactly as before (AC3). Seeded from storage on load, kept in
// sync by refreshWindows() on every add/remove/edit.
let activeWindows: PeakWin[] = [];

function storedTz(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function storeTz(tz: string): void {
  try { localStorage.setItem(STORAGE_KEY, tz); } catch { /* private mode — no-op */ }
}

// Peak-window persistence (AC5) — mirrors storedTz/storeTz: try/catch so private
// mode never throws. Serialized as "HH:MM-HH:MM,HH:MM-HH:MM". On read, every part
// is re-validated (regex + start<end) and any malformed/stale window is dropped
// silently, so a hand-edited or corrupt value can never break the page.
function storedPeak(): { startStr: string; endStr: string }[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(PEAK_KEY); } catch { return []; }
  if (!raw) return [];
  const out: { startStr: string; endStr: string }[] = [];
  for (const part of raw.split(',')) {
    const seg = part.split('-');
    if (seg.length !== 2) continue; // drop a hand-corrupted multi-dash part (AC5)
    const [s, e] = seg;
    if (!HHMM_RE.test(s || '') || !HHMM_RE.test(e || '')) continue;
    if (localHours(s) >= localHours(e)) continue;
    out.push({ startStr: s, endStr: e });
  }
  return out;
}
function storePeak(serial: string): void {
  try { localStorage.setItem(PEAK_KEY, serial); } catch { /* private mode — no-op */ }
}
function clearPeak(): void {
  try { localStorage.removeItem(PEAK_KEY); } catch { /* private mode — no-op */ }
}

type Card = { el: HTMLLIElement; bears: string[]; peak: string | null };

function readCards(): Card[] {
  const list = document.getElementById('result-list');
  if (!list) return [];
  return Array.from(list.querySelectorAll<HTMLLIElement>('.alliance-card')).map((el) => ({
    el,
    bears: [el.dataset.bear1, el.dataset.bear2].filter((t): t is string => !!t),
    peak: el.dataset.peak ? el.dataset.peak : null,
  }));
}

function applyToCard(card: Card, tz: string, bucket: Bucket): void {
  const bt = card.el.querySelector('[data-bear-times]');
  if (bt) bt.innerHTML = bearTimesHTML(card.bears.map((b) => toLocal(b, tz)));
  if (card.peak) {
    const pv = card.el.querySelector('[data-peak-val]');
    if (pv) pv.textContent = toLocal(card.peak, tz);
  }
  card.el.querySelectorAll('.lbl-text').forEach((l) => {
    l.textContent = (l.textContent || '').replace('· UTC', '· your local time');
  });
  const fit = card.el.querySelector('[data-fit]');
  if (fit) {
    fit.classList.remove('fit-great', 'fit-good', 'fit-stretch');
    fit.classList.add(`fit-${bucket}`);
    const dots = fit.querySelector('.fit-dots');
    const label = fit.querySelector('.fit-label');
    if (dots) dots.textContent = DOTS[bucket];
    if (label) label.textContent = LABELS[bucket];
  }
}

function render(tz: string): void {
  const nameEl = document.getElementById('tz-name');
  if (nameEl) nameEl.textContent = tz === 'UTC' ? 'UTC' : `${offsetLabel(tz)} · ${tz}`;
  const detectedEl = document.getElementById('tz-detected');
  if (detectedEl) detectedEl.textContent = storedTz() ? 'your choice' : 'auto-detected';

  // Never-push framing (AC6): when the visitor's own windows drive ranking, say
  // so ("your active times"); empty → the original evening framing. Stays
  // recommendation-voiced — no "we'll place you" / "matched" language.
  const lead = document.getElementById('finder-lead');
  if (lead) {
    lead.textContent = activeWindows.length
      ? 'Ranked against your active times — best fit first.'
      : 'Ranked by your local time — best fit first.';
  }

  const cards = readCards();
  const scored = cards.map((c) => ({ card: c, ...scoreTraps(c.bears, c.peak, tz, activeWindows) }));
  // best-fit first: bucket asc, then more traps fitting your windows, then smaller
  // distance / more buffer; Array.sort is stable for ties. (fits is 0 on the empty
  // path, so that term drops out and the legacy evening sort is unchanged — AC3.)
  scored.sort((a, b) => RANK[a.bucket] - RANK[b.bucket] || b.fits - a.fits || a.dist - b.dist);

  // No-good-match (AC2): nothing fits squarely when no card buckets great/good
  // (all stretch, incl. unfittable {stretch, Infinity}). Re-evaluated every render
  // because a different timezone moves cards in/out of the squarely-fits set.
  const hasGoodFit = scored.some((s) => s.bucket === 'great' || s.bucket === 'good');
  const noGoodMatch = cards.length > 0 && !hasGoodFit;
  const banner = document.getElementById('empty-banner');
  if (banner) banner.toggleAttribute('hidden', !noGoodMatch);

  const list = document.getElementById('result-list');
  scored.forEach((s, i) => {
    applyToCard(s.card, tz, s.bucket);
    // Gate the Best-fit ribbon (AC2): only crown rank-1 when a Great/Good fit
    // exists — never crown a Stretch/unfittable top card; the banner replaces it.
    s.card.el.classList.toggle('rank-1', i === 0 && hasGoodFit);
    if (list) list.appendChild(s.card.el); // moving an existing node re-orders the DOM
  });

  const count = document.getElementById('result-count');
  if (count) {
    const n = cards.length;
    count.textContent = `${n} ${n === 1 ? 'alliance' : 'alliances'} · times shown in your local time`;
  }
}

// --- timezone control wiring ---
const select = document.getElementById('tz-select') as HTMLSelectElement | null;
const selectWrap = document.getElementById('tz-select-wrap');
const changeBtn = document.getElementById('tz-change');

function ensureOption(tz: string): void {
  if (!select) return;
  if (!Array.from(select.options).some((o) => o.value === tz)) {
    const opt = document.createElement('option');
    opt.value = tz;
    opt.textContent = tz;
    select.insertBefore(opt, select.firstChild);
  }
  select.value = tz;
}

function openPicker(): void {
  if (selectWrap) selectWrap.removeAttribute('hidden');
  if (changeBtn) changeBtn.setAttribute('aria-expanded', 'true');
  if (select) select.focus();
}

// --- peak-window helpers (Story 2.5) -------------------------------------
const peakWindowsEl = document.getElementById('peak-windows');

function peakRows(): HTMLElement[] {
  return peakWindowsEl
    ? Array.from(peakWindowsEl.querySelectorAll<HTMLElement>('[data-peak-window]'))
    : [];
}

// Parse one row's two native time inputs (each is "" or a browser-validated
// "HH:MM"). A row is active only when BOTH are filled and start < end; a
// half-filled or start≥end row yields a plain inline message and is NOT scored.
// An untouched (both-empty) row is silent — not an error (AC4).
function parsePeakRow(row: HTMLElement): { win: PeakWin | null; serial: string | null; error: string | null } {
  const startStr = (row.querySelector<HTMLInputElement>('[data-peak-start]')?.value || '').trim();
  const endStr = (row.querySelector<HTMLInputElement>('[data-peak-end]')?.value || '').trim();
  if (!startStr && !endStr) return { win: null, serial: null, error: null };
  if (!startStr || !endStr) return { win: null, serial: null, error: 'Add both a start and end time.' };
  if (!HHMM_RE.test(startStr) || !HHMM_RE.test(endStr)) return { win: null, serial: null, error: 'Use a valid time.' };
  const start = localHours(startStr);
  const end = localHours(endStr);
  if (start >= end) return { win: null, serial: null, error: 'End needs to be after start — for overnight, add a second window.' };
  return { win: { start, end }, serial: `${startStr}-${endStr}`, error: null };
}

function setRowError(row: HTMLElement, error: string | null): void {
  const el = row.querySelector<HTMLElement>('[data-peak-error]');
  if (!el) return;
  el.textContent = error || '';
  el.toggleAttribute('hidden', !error);
}

// Re-read every row → set/clear inline errors, refresh activeWindows, persist the
// valid set. Deliberately render-free so it is safe to call during load (before
// the first render) and from recompute(). A bad row never aborts this loop.
function refreshWindows(): void {
  const wins: PeakWin[] = [];
  const serials: string[] = [];
  for (const row of peakRows()) {
    const { win, serial, error } = parsePeakRow(row);
    setRowError(row, error);
    if (win && serial) { wins.push(win); serials.push(serial); }
  }
  activeWindows = wins;
  if (serials.length) storePeak(serials.join(',')); else clearPeak();
}

function recompute(): void {
  refreshWindows();
  render(currentTz);
}

// The first row is never removable (clearing its inputs is how you return to the
// empty-windows / 20:30 behavior, AC3); every later row carries the remove "x".
function syncRemoveButtons(): void {
  peakRows().forEach((row, i) => {
    const btn = row.querySelector<HTMLElement>('[data-peak-remove]');
    if (btn) btn.toggleAttribute('hidden', i === 0);
  });
}

// Append a row by cloning the first (server-rendered) one — the clone carries the
// inline Lucide "x" SVG, so no JS-authored markup / emoji is introduced.
function addPeakRow(startStr = '', endStr = ''): void {
  const first = peakRows()[0];
  if (!peakWindowsEl || !first) return;
  const clone = first.cloneNode(true) as HTMLElement;
  const s = clone.querySelector<HTMLInputElement>('[data-peak-start]');
  const e = clone.querySelector<HTMLInputElement>('[data-peak-end]');
  if (s) s.value = startStr;
  if (e) e.value = endStr;
  setRowError(clone, null);
  peakWindowsEl.appendChild(clone);
  syncRemoveButtons();
}

// Rebuild rows from the validated stored set (AC5) and seed activeWindows. A
// corrupt value was already dropped by storedPeak(); refreshWindows() then
// re-persists the cleaned set. Render-free — the caller renders once after.
function restorePeakWindows(): void {
  const saved = storedPeak();
  const first = peakRows()[0];
  if (saved.length && first) {
    const s0 = first.querySelector<HTMLInputElement>('[data-peak-start]');
    const e0 = first.querySelector<HTMLInputElement>('[data-peak-end]');
    if (s0) s0.value = saved[0].startStr;
    if (e0) e0.value = saved[0].endStr;
    for (let i = 1; i < saved.length; i++) addPeakRow(saved[i].startStr, saved[i].endStr);
  }
  syncRemoveButtons();
  refreshWindows();
}

// Timezone resolution order (Task 3):
//   1. a valid stored override wins and survives reload;
//   2. else drop a stale/invalid stored value, then auto-detect;
//   3. else (detect throws or returns empty) fall back to the MANUAL pick — open
//      the picker, say so plainly, and keep honest UTC until a zone is picked.
// A legitimate UTC visitor (detect succeeds → "UTC") is NOT a failure.
const stored = storedTz();
let currentTz = 'UTC';
let detectFailed = false;
if (isValidTz(stored)) {
  currentTz = stored;
} else {
  if (stored) {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* private mode — no-op */ }
  }
  const detected = detectTz();
  if (detected && isValidTz(detected)) currentTz = detected;
  else detectFailed = true; // currentTz stays 'UTC'
}
try {
  ensureOption(currentTz);
  // Seed declared windows before the first render so the initial ranking already
  // reflects them (AC5). Inside the try so a throw here still hits the finally and
  // never freezes the page behind the skeleton (the Story 2.3 freeze-guard lesson).
  restorePeakWindows();
  if (detectFailed) {
    // Honest UTC, unranked, with the manual picker open — picking runs render().
    openPicker();
    const detectedEl = document.getElementById('tz-detected');
    if (detectedEl) detectedEl.textContent = "couldn't detect — pick below";
  } else {
    render(currentTz);
  }
} finally {
  // Clear the loading skeleton (AC1) — in `finally` so a throw anywhere in the
  // resolve (toLocal/offsetLabel on an edge runtime, etc.) can never leave the page
  // frozen behind skeletons, which is strictly worse than the no-JS path. On the
  // happy path this runs after render() so the visitor never sees the UTC→local
  // flip; on the detect-failed path it reveals the honest UTC cards.
  document.documentElement.removeAttribute('data-finder-resolving');
}

if (changeBtn && selectWrap) {
  changeBtn.addEventListener('click', () => {
    if (selectWrap.hasAttribute('hidden')) {
      openPicker();
    } else {
      selectWrap.setAttribute('hidden', '');
      changeBtn.setAttribute('aria-expanded', 'false');
    }
  });
}
if (select) {
  select.addEventListener('change', () => {
    currentTz = select.value;
    storeTz(currentTz);
    render(currentTz);
  });
}

// --- peak-window control wiring (Story 2.5) ---
const peakAddBtn = document.getElementById('peak-add');
if (peakAddBtn) {
  peakAddBtn.addEventListener('click', () => {
    addPeakRow();
    recompute();
  });
}
if (peakWindowsEl) {
  // Re-validate + re-rank on every edit to a window time (AC2/AC4).
  peakWindowsEl.addEventListener('input', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && t.matches('[data-peak-start], [data-peak-end]')) recompute();
  });
  // Remove control — event-delegated because rows are added dynamically. Never
  // removes the last row (the first row is the always-present empty baseline).
  peakWindowsEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement | null;
    const btn = t ? t.closest('[data-peak-remove]') : null;
    if (!btn) return;
    const row = btn.closest<HTMLElement>('[data-peak-window]');
    if (row && peakRows().length > 1) row.remove();
    syncRemoveButtons();
    recompute();
  });
}
