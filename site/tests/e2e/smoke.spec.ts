import { test, expect, type Page } from '@playwright/test';

// Smoke suite for the public site. Works against BOTH build flavors:
// unconfigured (no DIRECTUS_TOKEN — static seed, empty guides) and
// configured (live Directus data). State-dependent assertions branch on
// what the build actually contains, never on how it was produced.

test.describe('home', () => {
  test('loads with nav and entry points', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Kingdom 1516/);
    const nav = page.locator('nav').first();
    await expect(nav.getByRole('link', { name: 'Tools', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Alliance Finder' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Guides', exact: true })).toBeVisible();
    expect(await page.locator('main a[href]').count()).toBeGreaterThanOrEqual(2);
  });

  test('theme toggle flips, persists, survives reload', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Toggle dark mode' });
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await toggle.click();
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(after).not.toBe(before);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBeTruthy();
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(after);
  });
});

test.describe('finder', () => {
  test('renders ranked alliances or a calm state — never a dead end', async ({ page }) => {
    await page.goto('/finder/');
    const main = page.locator('main');
    await expect(main).toContainText(/alliance/i);
    const text = (await main.innerText()).trim();
    expect(text.length).toBeGreaterThan(100);
  });
});

test.describe('join', () => {
  test('apply page renders the form shell', async ({ page }) => {
    await page.goto('/join/');
    await expect(page.getByRole('heading', { name: 'Apply to transfer' })).toBeVisible();
  });

  test('yes/no radios render inline and are checkable', async ({ page }) => {
    // Regression: generic .field input/label rules once gave the radios width:100%
    // and block labels — circle stacked above its text instead of beside it.
    await page.goto('/join/');
    const opts = page.locator('.yn-opt');
    expect(await opts.count()).toBeGreaterThanOrEqual(4);
    for (const opt of await opts.all()) {
      const input = await opt.locator('input').boundingBox();
      const text = await opt.locator('span').boundingBox();
      expect(input!.width).toBeLessThan(30);
      expect(Math.abs((input!.y + input!.height / 2) - (text!.y + text!.height / 2))).toBeLessThan(8);
      expect(input!.x + input!.width).toBeLessThanOrEqual(text!.x + 2);
    }
    const yes = page.locator('input[name="team_player_kvk"][value="yes"]');
    await yes.check();
    await expect(yes).toBeChecked();
  });
});

test.describe('tools', () => {
  test('external tool links open in a new tab with noopener', async ({ page }) => {
    await page.goto('/tools/');
    const external = page.locator('main a[target="_blank"]');
    expect(await external.count()).toBeGreaterThan(0);
    for (const rel of await external.evaluateAll(as => as.map(a => (a as HTMLAnchorElement).rel))) {
      expect(rel).toContain('noopener');
    }
  });
});

// The two calculators below are guarded by number/text/localStorage assertions only,
// never by CSS — the local Node-24 build ships no stylesheets (site/CLAUDE.md).
const VIKINGS = '/tools/vikings-vengeance-calculator/';

// One column of the send table across every march-group row (0 = Inf, 1 = Cav,
// 2 = Arch, 3 = Size). Every caller must assert the result is non-empty first —
// `[].every()` is vacuously true. The minus sign survives parsing so a sign-flipped
// regression can't read as a valid count.
const marchCol = (page: Page, col: number) =>
  page.locator('#sendTable tbody tr').evaluateAll((rows, c) =>
    rows.map((r) => Number(r.querySelectorAll('td')[c].textContent!.replace(/[^\d-]/g, ''))),
    col);

async function setNum(page: Page, id: string, value: string) {
  const el = page.locator('#' + id);
  await el.fill(value);
  await el.dispatchEvent('input');
  await el.dispatchEvent('change');
}

// The event sends 6 FULL marches of the active march size. That size is
// round((squad base + Bison + Marshal) × (1 + deploy)) — it does NOT depend on the
// troop pool; at the default squad base with no buffs it is 130,710. The pool only
// bounds the fill: each march draws on floor(pool / 6) of every troop type, so at
// the default 60/40/0 ratio a full march is 78,426 Inf + 52,284 Cav.
const MARCH_SIZE = 130710;

test.describe('vikings vengeance calculator', () => {
  test('fills all 6 marches and deploys zero archers at defaults', async ({ page }) => {
    await page.goto(VIKINGS);
    await expect(page.getByRole('heading', { name: 'Vikings Vengeance Squad Calculator' })).toBeVisible();
    expect(await page.locator('#sendTable tbody tr th').allInnerTexts()).toEqual(['Marches ×6']);
    const arch = await marchCol(page, 2);
    const size = await marchCol(page, 3);
    expect(arch.length).toBeGreaterThan(0);
    expect(arch.every((v) => v === 0)).toBeTruthy();
    expect(size.every((v) => v === MARCH_SIZE)).toBeTruthy();
    // The default pool fills all 6 marches exactly, so NEITHER warning may fire —
    // without this the under-fill trigger could be `<=` and still pass everywhere.
    await expect(page.locator('#warnings')).toBeEmpty();
    // 6 × 130,710: the requirement stat and the total actually used agree here.
    await expect(page.locator('#marchesTotal')).toHaveText('784,260');
    expect(await page.locator('#sendTable tfoot tr th').innerText()).toBe('Total used');
    const foot = await page.locator('#sendTable tfoot tr td').allInnerTexts();
    expect(foot[foot.length - 1]).toBe('784,260');
  });

  test('the exact under-fill boundary: one troop short flips the warning on', async ({ page }) => {
    await page.goto(VIKINGS);
    // 6 × 78,426 Inf and 6 × 52,284 Cav is the precise requirement for 6 full
    // marches at 60/40/0 — no leftovers, no warning.
    await setNum(page, 'tInf', '470556');
    await setNum(page, 'tCav', '313704');
    await setNum(page, 'tArch', '0');
    expect((await marchCol(page, 3)).every((v) => v === MARCH_SIZE)).toBeTruthy();
    await expect(page.locator('#warnings')).toBeEmpty();
    // One infantry short: floor(470,555 / 6) = 78,425, so every march loses a troop.
    await setNum(page, 'tInf', '470555');
    await expect(page.locator('#warnings')).toContainText(/not enough troops/i);
    expect(await marchCol(page, 3)).toEqual([130709]);
  });

  test('a march size that does not divide evenly hands the remainder to infantry', async ({ page }) => {
    await page.goto(VIKINGS);
    await setNum(page, 'squadBase', '130711');
    // floor(130,711 × 0.6) + floor(130,711 × 0.4) = 78,426 + 52,284 leaves the odd
    // troop over; priority pass 2 must give it to Infantry, never to Archers.
    expect(await marchCol(page, 0)).toEqual([78427]);
    expect(await marchCol(page, 1)).toEqual([52284]);
    expect(await marchCol(page, 2)).toEqual([0]);
    expect(await marchCol(page, 3)).toEqual([130711]);
  });

  test('spare infantry absorbs a total cavalry shortfall', async ({ page }) => {
    await page.goto(VIKINGS);
    await setNum(page, 'tCav', '0');
    await setNum(page, 'tInf', '900000');
    const [inf, cav, arch] = [await marchCol(page, 0), await marchCol(page, 1), await marchCol(page, 2)];
    expect(inf.length).toBeGreaterThan(0);
    expect(inf.every((v) => v === MARCH_SIZE)).toBeTruthy();
    expect(cav.every((v) => v === 0)).toBeTruthy();
    expect(arch.every((v) => v === 0)).toBeTruthy();
  });

  test('archers deploy only as a last resort — and the page says so', async ({ page }) => {
    await page.goto(VIKINGS);
    await setNum(page, 'tCav', '0');
    await setNum(page, 'tInf', '200000');
    const arch = await marchCol(page, 2);
    expect(arch.length).toBeGreaterThan(0);
    expect(arch.every((v) => v > 0)).toBeTruthy();
    await expect(page.locator('#warnings')).toContainText(/last resort/i);
    // 6 × floor(429,106 / 6) archers — the warning must name the formatted total,
    // not just admit that something happened.
    await expect(page.locator('#warnings')).toContainText('429,102');
  });

  test('an archer share the pool cannot deliver is released, marches still fill', async ({ page }) => {
    await page.goto(VIKINGS);
    await setNum(page, 'rInfA', '50');
    await setNum(page, 'rCavA', '30');
    await setNum(page, 'rArchA', '20');
    await setNum(page, 'tArch', '0');
    await setNum(page, 'tInf', '900000');
    const arch = await marchCol(page, 2);
    const size = await marchCol(page, 3);
    expect(size.length).toBeGreaterThan(0);
    expect(size.every((v) => v === MARCH_SIZE)).toBeTruthy();
    expect(arch.every((v) => v === 0)).toBeTruthy();
  });

  test('half & half split renders two groups of three, each drawing its own sixth', async ({ page }) => {
    await page.goto(VIKINGS);
    // The segmented control hides its radios visually (the label is the hit target),
    // so drive the input directly instead of clicking it.
    await page.locator('input[name="splitMode"][value="half"]').evaluate((n) => (n as HTMLElement).click());
    await expect(page.locator('#ratioB')).toBeVisible();
    await expect(page.locator('#ratioC')).toBeHidden();
    expect(await page.locator('#sendTable tbody tr th').allInnerTexts())
      .toEqual(['Marches A ×3', 'Marches B ×3']);
    // Every march gets floor(pool / 6) regardless of its group, so ratio B (70/30/0)
    // hits its 80,000 infantry budget and the gap falls to Cavalry — never Archers.
    expect(await marchCol(page, 0)).toEqual([78426, 80000]);
    expect(await marchCol(page, 1)).toEqual([52284, 50710]);
    expect(await marchCol(page, 2)).toEqual([0, 0]);
    expect(await marchCol(page, 3)).toEqual([MARCH_SIZE, MARCH_SIZE]);
  });

  test('thirds split renders three march groups, all full with zero archers', async ({ page }) => {
    await page.goto(VIKINGS);
    // The segmented control hides its radios visually (the label is the hit target),
    // so drive the input directly instead of clicking it.
    await page.locator('input[name="splitMode"][value="thirds"]').evaluate((n) => (n as HTMLElement).click());
    await expect(page.locator('#ratioB')).toBeVisible();
    await expect(page.locator('#ratioC')).toBeVisible();
    expect(await page.locator('#sendTable tbody tr th').allInnerTexts())
      .toEqual(['Marches A ×2', 'Marches B ×2', 'Marches C ×2']);
    const arch = await marchCol(page, 2);
    const size = await marchCol(page, 3);
    expect(arch.length).toBe(3);
    expect(arch.every((v) => v === 0)).toBeTruthy();
    expect(size.every((v) => v === MARCH_SIZE)).toBeTruthy();
  });

  test('a pool too small for 6 full marches shrinks them and says so', async ({ page }) => {
    await page.goto(VIKINGS);
    await setNum(page, 'tInf', '200000');
    await setNum(page, 'tCav', '60000');
    await setNum(page, 'tArch', '0');
    await expect(page.locator('#warnings')).toContainText(/not enough troops/i);
    // floor(200,000/6) Inf + floor(60,000/6) Cav is all a march can draw on.
    const size = await marchCol(page, 3);
    expect(size.length).toBeGreaterThan(0);
    expect(size.every((v) => v === 43333)).toBeTruthy();
  });

  test('has no rally, join-cap, Valora or Max Archer controls', async ({ page }) => {
    await page.goto(VIKINGS);
    expect(await page.locator('#rallySize').count()).toBe(0);
    expect(await page.locator('#joinCap').count()).toBe(0);
    expect(await page.locator('#usePct').count()).toBe(0);
    expect(await page.locator('#valoraOn').count()).toBe(0);
    expect(await page.locator('#valoraSquad').count()).toBe(0);
    expect(await page.locator('#valoraRally').count()).toBe(0);
    expect(await page.locator('#maxArcher').count()).toBe(0);
  });

  test('a saved state or share link carrying removed ids still loads', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(VIKINGS);
    // A state written by the rally-era version: the live ids must apply, the three
    // obsolete ones must be ignored rather than throwing.
    await page.evaluate(() => localStorage.setItem('vikingcalc.state', JSON.stringify({
      tInf: '480000', tCav: '320000', tArch: '429106', squadBase: '200000',
      marshalTier: '0', deploy: '0', bisonLevel: '0', splitMode: 'uniform',
      rInfA: '60', rCavA: '40', rArchA: '0', rInfB: '70', rCavB: '30', rArchB: '0',
      rInfC: '100', rCavC: '0', rArchC: '0',
      rallySize: '1022710', joinCap: '80000', usePct: '1',
    })));
    await page.reload();
    await expect(page.locator('#squadBase')).toHaveValue('200000');
    await expect(page.locator('#squadSize')).toHaveText('200,000');
    expect((await marchCol(page, 3)).length).toBeGreaterThan(0);

    // Same for a shared link: the known id applies, the obsolete one is dropped.
    await page.goto(VIKINGS + '#joinCap=80000&tInf=480000');
    await expect(page.locator('#tInf')).toHaveValue('480000');
    expect(await page.locator('#joinCap').count()).toBe(0);
    expect((await marchCol(page, 3)).length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('state persists under its own key, never the bear key', async ({ page }) => {
    await page.goto(VIKINGS);
    await setNum(page, 'squadBase', '123456');
    expect(await page.evaluate(() => localStorage.getItem('vikingcalc.state'))).toContain('123456');
    await page.reload();
    await expect(page.locator('#squadBase')).toHaveValue('123456');
    expect(await page.evaluate(() => localStorage.getItem('bearcalc.state'))).toBeNull();
  });
});

test.describe('bear trap calculator', () => {
  test('Mighty Bison Lv 10 adds exactly 15,000 and survives a reload', async ({ page }) => {
    await page.goto('/tools/bear-trap-calculator/');
    const squad = async () => Number((await page.locator('#squadSize').innerText()).replace(/[^\d]/g, ''));
    const before = await squad();
    expect(before).toBeGreaterThan(0);
    await page.locator('#bisonLevel').selectOption('15000');
    await expect.poll(squad).toBe(before + 15000);
    await page.reload();
    await expect(page.locator('#bisonLevel')).toHaveValue('15000');
    await expect.poll(squad).toBe(before + 15000);
  });
});

test.describe('guides', () => {
  test('shows category cards with search, or the empty-KB zero state without search', async ({ page }) => {
    await page.goto('/guides/');
    const zero = page.locator('.kb-zero');
    if (await zero.count()) {
      await expect(zero).toContainText(/no guides published yet/i);
      expect(await page.locator('#guide-search').count()).toBe(0);
    } else {
      await expect(page.locator('#guide-search')).toBeVisible();
    }
  });

  test('search index endpoint returns a JSON array', async ({ request }) => {
    const res = await request.get('/guides-index.json');
    expect(res.ok()).toBeTruthy();
    expect(Array.isArray(await res.json())).toBeTruthy();
  });
});

test.describe('leader', () => {
  test('login form present; failed sign-in shows a calm error, never a dead end', async ({ page }) => {
    await page.goto('/leader/');
    const email = page.locator('input[type="email"]');
    const password = page.locator('input[type="password"]');
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    await email.fill('smoke-test@example.com');
    await password.fill('definitely-wrong');
    await page.getByRole('button', { name: 'Log in' }).click();
    const error = page.locator('#login-error');
    await expect(error).toBeVisible({ timeout: 10_000 });
    expect((await error.innerText()).trim().length).toBeGreaterThan(0);
    // form stays usable
    await expect(page.getByRole('button', { name: 'Log in' })).toBeEnabled();
  });
});

test.describe('admin', () => {
  test('without a session the admin shell never exposes data', async ({ page }) => {
    await page.goto('/admin/');
    // Either the client redirects to /leader (live backend, no session)
    // or it shows the calm unreachable message (no backend at all).
    await expect
      .poll(async () => page.url().includes('/leader') || (await page.getByRole('alert').count()) > 0, { timeout: 10_000 })
      .toBeTruthy();
  });
});
