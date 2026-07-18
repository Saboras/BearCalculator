import { test, expect } from '@playwright/test';

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
