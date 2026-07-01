/*
  Alliance Finder — pure timezone-conversion + best-fit ranking logic.

  No DOM, no localStorage: every function here is a pure transform over plain data
  (strings, numbers, PeakWin[]), so the subtle ranking maths — circular evening
  distance, ±30-min event containment, inside-window buffer scoring — is isolated
  and unit-testable. The DOM/session wiring that calls this lives in ./index.ts.
*/

// --- Fit window (LOCAL hours). Tunable product default (story Open Q #2):
//     prime evening centres on ~20:30. A symmetric *circular* distance from the
//     centre handles midnight wrap intrinsically — 00:30 local is ~4h from
//     20:30, not 20h — so no manual day arithmetic is needed. ---
const EVENING_CENTER = 20.5;   // ~20:30
const GREAT_MAX_DIST = 2.5;    // within ±2.5h → 18:00–23:00 core  → Great
const GOOD_MAX_DIST = 4.5;     // next ±2h → 16:00–18:00 & 23:00–01:00 → Good
// beyond GOOD_MAX_DIST → Stretch

export type PeakWin = { start: number; end: number }; // fractional LOCAL hours, start < end
export type Bucket = 'great' | 'good' | 'stretch';

export const DOTS: Record<Bucket, string> = { great: '●●●', good: '●●○', stretch: '●○○' };
export const LABELS: Record<Bucket, string> = { great: 'Great fit', good: 'Good fit', stretch: 'Stretch' };
export const RANK: Record<Bucket, number> = { great: 0, good: 1, stretch: 2 };

// Returns null on failure (throw or empty) so a true detect failure (→ manual pick)
// is distinguishable from a legitimate UTC visitor. NOT 'UTC'.
export function detectTz(): string | null {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}
// A stale/invalid stored zone (renamed IANA id, hand-edited junk) would make Intl throw
// in toLocal and abort the whole render — validate at the boundary so an unresolvable
// zone never reaches the hot path. detectTz()/'UTC' are always resolvable fallbacks.
export function isValidTz(tz: string | null): tz is string {
  if (!tz) return false;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch { return false; }
}

// UTC "HH:MM" time-of-day → local "HH:MM" for an IANA zone, anchored on TODAY so
// the current DST offset applies. Intl handles fractional offsets (+5:30/+5:45)
// and midnight wrap; hourCycle 'h23' avoids the "24:00"-for-midnight quirk.
// DST caveat (accepted): no anchor date is stored, so a time near a DST boundary
// could shift an hour at the real event date — fine for a hobby tool.
export function toLocal(utc: string, tz: string): string {
  const [h, m] = utc.split(':').map(Number);
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m));
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d);
}
export function localHours(localHHMM: string): number {
  const [h, m] = localHHMM.split(':').map(Number);
  return h + m / 60;
}
function distFromEvening(hours: number): number {
  const raw = Math.abs(hours - EVENING_CENTER);
  return Math.min(raw, 24 - raw); // circular, 0..12
}
// --- Windows-aware fit (Story 2.5) -------------------------------------------
// A Bear Trap is a ~30-min event the player wants lead time for, so a real "Great"
// fit means being active across the whole event, not just the instant:
//   Great   — [t-30min, t+30min] sits fully INSIDE a declared window
//   Good    — the trap instant t is inside a window, but the ±30-min pad pokes out
//             (you catch the trap, but with no prep / it runs past your window)
//   Stretch — t is outside every window (you are not online)
// Declared windows REPLACE the evening centre; empty windows → the distFromEvening
// path below, byte-for-byte unchanged (AC3). Containment is checked directly (no
// edge-distance bucketing), so the old non-circular near-midnight asymmetry no
// longer affects ranking. Residual v1 edge: a pad crossing midnight (trap within
// 30 min of 00:00) can't match a late window — overnight is entered as two rows.
const EVENT_PAD = 0.5; // 30-min lead-in + 30-min event duration around the trap

function windowBucket(hours: number, windows: PeakWin[]): Bucket {
  let inAny = false;
  for (const w of windows) {
    if (hours - EVENT_PAD >= w.start && hours + EVENT_PAD <= w.end) return 'great';
    if (hours >= w.start && hours <= w.end) inAny = true;
  }
  return inAny ? 'good' : 'stretch';
}
// Sort metric for the windows path (lower = better): a trap CENTRED in a window
// scores most-negative (max buffer before AND after), an edge trap ≈ 0, and a trap
// OUTSIDE a window its positive distance to the nearest edge. Used only to order
// cards within a bucket — best-buffered first — never for bucketing. So among
// equally-"Great" alliances, the one whose Bear Trap sits deepest in your window
// (most lead-in + wind-down) ranks first.
function windowScore(hours: number, windows: PeakWin[]): number {
  let best = Infinity;
  for (const w of windows) {
    const s = (hours >= w.start && hours <= w.end)
      ? -Math.min(hours - w.start, w.end - hours)                     // inside: more buffer → lower
      : Math.min(Math.abs(hours - w.start), Math.abs(hours - w.end)); // outside: edge distance
    if (s < best) best = s;
  }
  return best;
}
// One fit per local hour: windows when present (containment bucket + buffer-ranked
// score), else the unchanged evening centre. Returns bucket + a sort metric.
function fitOf(hours: number, windows: PeakWin[]): { bucket: Bucket; dist: number } {
  if (windows.length === 0) {
    const d = distFromEvening(hours);
    return { bucket: bucketOf(d), dist: d };
  }
  return { bucket: windowBucket(hours, windows), dist: windowScore(hours, windows) };
}
function bucketOf(dist: number): Bucket {
  if (dist <= GREAT_MAX_DIST) return 'great';
  if (dist <= GOOD_MAX_DIST) return 'good';
  return 'stretch';
}
export function offsetLabel(tz: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date()).find((p) => p.type === 'timeZoneName');
    const v = part ? part.value : '';
    return v.replace('GMT', 'UTC') || 'UTC';
  } catch { return 'UTC'; }
}
export function bearTimesHTML(times: string[]): string {
  if (times.length === 0) return '<span class="t-none">No Bear Trap time set</span>';
  return times.map((t) => `<span class="t">${t}</span>`).join('<span class="amp">&amp;</span>');
}

// The card's bucket is its BEST single trap (best case you can attend one event
// well). `fits` = how many of its traps fall inside your windows — a card whose
// BOTH traps you can make outranks one where only one fits (windows path only).
// `dist` orders the rest: on the windows path, Σ inside-buffer over ONLY the traps
// that fit (each ≤ 0; more negative = better-buffered / more centred). Outside traps
// are NOT summed, so a trap you can't attend never pulls the ranking. On the empty
// path, the closest distance to the evening centre (byte-for-byte the legacy sort, AC3).
export function scoreTraps(
  bears: string[], peak: string | null, tz: string, windows: PeakWin[],
): { bucket: Bucket; fits: number; dist: number } {
  if (bears.length === 0) return { bucket: 'stretch', fits: 0, dist: Infinity }; // unfittable → last
  const useWindows = windows.length > 0;
  let bucket: Bucket = 'stretch';
  let best = Infinity; // empty path: closest single trap to the evening centre
  let buffer = 0;      // windows path: Σ inside-buffer over the traps that fit (≤ 0)
  let fits = 0;        // windows path: how many traps land inside a window
  for (const b of bears) {
    const f = fitOf(localHours(toLocal(b, tz)), windows);
    if (RANK[f.bucket] < RANK[bucket]) bucket = f.bucket;
    if (f.dist < best) best = f.dist;
    if (useWindows && f.bucket !== 'stretch') { fits++; buffer += f.dist; } // f.dist ≤ 0 when inside
  }
  // Peak booster — DEFERRED on the windows path: alliance `peak` is null today and is
  // NOT a Bear Trap, so it must not lift the windows bucket or count as a fit. The
  // legacy evening path keeps its original Good→Great-only promotion so AC3 stays
  // byte-for-byte unchanged.
  if (peak && !useWindows) {
    const f = fitOf(localHours(toLocal(peak, tz)), windows);
    if (bucket === 'good' && f.bucket === 'great') bucket = 'great';
    if (f.dist < best) best = f.dist;
  }
  return { bucket, fits, dist: useWindows ? buffer : best };
}
