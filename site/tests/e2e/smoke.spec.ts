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

// One column of the send table for the JOINER rows only (0 = Inf, 1 = Cav, 2 = Arch,
// 3 = Size). The own rally is excluded: it is a pool-independent target, so it is not
// bound by the per-joiner budgets these tests pin down. Every caller must assert the
// result is non-empty first — `[].every()` is vacuously true. The minus sign survives
// parsing so a sign-flipped regression can't read as a valid count.
const joinerCol = (page: Page, col: number) =>
  page.locator('#sendTable tbody tr').evaluateAll((rows, c) =>
    rows
      .filter((r) => !r.classList.contains('own-row'))
      .map((r) => Number(r.querySelectorAll('td')[c].textContent!.replace(/[^\d-]/g, ''))),
    col);

// The own-rally row as [Inf, Cav, Arch, Size].
const ownRow = (page: Page) =>
  page.locator('#sendTable tbody tr.own-row td').evaluateAll((tds) =>
    tds.map((td) => Number(td.textContent!.replace(/[^\d-]/g, ''))));

async function setNum(page: Page, id: string, value: string) {
  const el = page.locator('#' + id);
  await el.fill(value);
  await el.dispatchEvent('input');
  await el.dispatchEvent('change');
}

test.describe('vikings vengeance calculator', () => {
  test('loads and deploys zero archers at defaults', async ({ page }) => {
    await page.goto(VIKINGS);
    await expect(page.getByRole('heading', { name: 'Vikings Vengeance Squad Calculator' })).toBeVisible();
    const arch = await joinerCol(page, 2);
    expect(arch.length).toBeGreaterThan(0);
    expect(arch.every((v) => v === 0)).toBeTruthy();
    expect((await ownRow(page))[2]).toBe(0);
  });

  test('a join cap that does not divide evenly still deploys zero archers', async ({ page }) => {
    await page.goto(VIKINGS);
    await setNum(page, 'joinCap', '80001');
    const arch = await joinerCol(page, 2);
    expect(arch.length).toBeGreaterThan(0);
    expect(arch.every((v) => v === 0)).toBeTruthy();
  });

  test('a tight infantry budget hands the rounding remainder to cavalry, not archers', async ({ page }) => {
    await page.goto(VIKINGS);
    await setNum(page, 'tInf', '300000');
    await setNum(page, 'joinCap', '80001');
    const arch = await joinerCol(page, 2);
    const size = await joinerCol(page, 3);
    expect(arch.length).toBeGreaterThan(0);
    expect(arch.every((v) => v === 0)).toBeTruthy();
    expect(size.every((v) => v === 80001)).toBeTruthy();
  });

  test('spare infantry absorbs a total cavalry shortfall', async ({ page }) => {
    await page.goto(VIKINGS);
    await setNum(page, 'tCav', '0');
    await setNum(page, 'tInf', '900000');
    const [inf, cav, arch] = [await joinerCol(page, 0), await joinerCol(page, 1), await joinerCol(page, 2)];
    expect(inf.length).toBeGreaterThan(0);
    expect(inf.every((v) => v === 80000)).toBeTruthy();
    expect(cav.every((v) => v === 0)).toBeTruthy();
    expect(arch.every((v) => v === 0)).toBeTruthy();
  });

  test('archers deploy only as a last resort — and the page says so', async ({ page }) => {
    await page.goto(VIKINGS);
    await setNum(page, 'tCav', '0');
    await setNum(page, 'tInf', '200000');
    const arch = await joinerCol(page, 2);
    expect(arch.length).toBeGreaterThan(0);
    expect(arch.every((v) => v > 0)).toBeTruthy();
    await expect(page.locator('#warnings')).toContainText(/last resort/i);
  });

  test('an archer share the pool cannot deliver is released, joiners still reach the cap', async ({ page }) => {
    await page.goto(VIKINGS);
    await setNum(page, 'rInfA', '50');
    await setNum(page, 'rCavA', '30');
    await setNum(page, 'rArchA', '20');
    await setNum(page, 'tArch', '0');
    await setNum(page, 'tInf', '900000');
    const arch = await joinerCol(page, 2);
    const size = await joinerCol(page, 3);
    expect(size.length).toBeGreaterThan(0);
    expect(size.every((v) => v === 80000)).toBeTruthy();
    expect(arch.every((v) => v === 0)).toBeTruthy();
  });

  test('an odd squad size at ratio 0/50/50 renders no negative own-rally cell', async ({ page }) => {
    await page.goto(VIKINGS);
    await setNum(page, 'squadBase', '130711');
    await setNum(page, 'rInfA', '0');
    await setNum(page, 'rCavA', '50');
    await setNum(page, 'rArchA', '50');
    // Cav and Arch each round UP here, so their sum overshoots the squad by 1 and
    // Infantry would render as −1. The exact triple pins the trim that gives the
    // extra troop back from Archers, in both the plain and the whole-percent path.
    expect(await ownRow(page)).toEqual([0, 65356, 65355, 130711]);
    await page.locator('#usePct').check();
    expect(await ownRow(page)).toEqual([0, 65356, 65355, 130711]);
  });

  test('thirds split renders three joiner groups, all at the cap with zero archers', async ({ page }) => {
    await page.goto(VIKINGS);
    // The segmented control hides its radios visually (the label is the hit target),
    // so drive the input directly instead of clicking it.
    await page.locator('input[name="splitMode"][value="thirds"]').evaluate((n) => (n as HTMLElement).click());
    await expect(page.locator('#ratioB')).toBeVisible();
    await expect(page.locator('#ratioC')).toBeVisible();
    expect(await page.locator('#sendTable tbody tr.own-row').count()).toBe(1);
    expect(await page.locator('#sendTable tbody tr:not(.own-row) th').allInnerTexts())
      .toEqual(['Joiners A ×2', 'Joiners B ×2', 'Joiners C ×2']);
    const arch = await joinerCol(page, 2);
    const size = await joinerCol(page, 3);
    expect(arch.length).toBe(3);
    expect(arch.every((v) => v === 0)).toBeTruthy();
    expect(size.every((v) => v === 80000)).toBeTruthy();
  });

  test('has no Valora and no Max Archer controls', async ({ page }) => {
    await page.goto(VIKINGS);
    expect(await page.locator('#valoraOn').count()).toBe(0);
    expect(await page.locator('#valoraSquad').count()).toBe(0);
    expect(await page.locator('#valoraRally').count()).toBe(0);
    expect(await page.locator('#maxArcher').count()).toBe(0);
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
