import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Differential test: the ported Bear Trap calculator must produce EXACTLY the
// same numbers as the legacy calculator (repo-root index.html — the ratified
// source of truth for functionality). Layout may differ (the send table is
// transposed in the port), so tables compare as number multisets.

const LEGACY_URL = new URL('../../../index.html', import.meta.url);

const SCENARIOS: { name: string; set: Record<string, string> }[] = [
  { name: 'defaults', set: {} },
  { name: 'big rally', set: { rallySize: '2200000', joinCap: '20', tInf: '55', tCav: '25', tArch: '20' } },
  { name: 'archer cap toggled', set: { rallySize: '1500000', maxArcher: 'check' } },
  { name: 'small numbers', set: { rallySize: '100000', joinCap: '5' } },
  { name: 'custom ratios + deploy', set: { rInfA: '20', rCavA: '30', rArchA: '50', deploy: '0.2' } },
  { name: 'thirds split + valora', set: { splitMode: 'thirds', valoraOn: 'check', valoraRally: '150000' } },
];

async function applyScenario(page: Page, set: Record<string, string>) {
  for (const [id, val] of Object.entries(set)) {
    if (id === 'splitMode') {
      // port = radio group, legacy = select; same values
      const radio = page.locator(`input[name="splitMode"][value="${val}"]`);
      if (await radio.count()) await radio.evaluate(n => (n as HTMLElement).click());
      else await page.locator('#splitMode').evaluate((n, v) => {
        (n as HTMLSelectElement).value = v;
        n.dispatchEvent(new Event('input', { bubbles: true }));
        n.dispatchEvent(new Event('change', { bubbles: true }));
      }, val);
      continue;
    }
    const el = page.locator('#' + id);
    const kind = await el.evaluate(n => n.tagName === 'SELECT' ? 'select' : ((n as HTMLInputElement).type || 'text'));
    if (kind === 'select') await el.selectOption(val);
    else if (kind === 'checkbox' || kind === 'radio') await el.evaluate(n => { if (!(n as HTMLInputElement).checked) (n as HTMLElement).click(); });
    else if (!(await el.isVisible())) {
      // hidden in the default UI state on both versions — set identically via JS
      await el.evaluate((n, v) => {
        (n as HTMLInputElement).value = v;
        n.dispatchEvent(new Event('input', { bubbles: true }));
        n.dispatchEvent(new Event('change', { bubbles: true }));
      }, val);
    } else {
      await el.fill(val);
      await el.dispatchEvent('input');
      await el.dispatchEvent('change');
    }
  }
  await page.waitForTimeout(300);
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const text = (id: string) => document.getElementById(id)?.textContent?.trim() ?? null;
    const tableText = (id: string) => (document.getElementById(id) as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? null;
    return {
      rallySizeTotal: text('rallySizeTotal'),
      squadBase: text('squadBase'),
      rallyFormula: text('rallyFormula'),
      squadFormula: text('squadFormula'),
      distHint: text('distHint'),
      sendTable: tableText('sendTable'),
      grid9body: tableText('grid9body'),
    };
  });
}

const numberMultiset = (s: string | null) =>
  (String(s ?? '').match(/[\d,]+/g) ?? []).map(x => x.replace(/,/g, '')).filter(Boolean).sort().join('|');

for (const scenario of SCENARIOS) {
  test(`parity vs legacy: ${scenario.name}`, async ({ page, context }) => {
    await page.goto('/tools/bear-trap-calculator/');
    const legacy = await context.newPage();
    await legacy.goto(LEGACY_URL.href);

    await applyScenario(page, scenario.set);
    await applyScenario(legacy, scenario.set);

    const a = await snapshot(page);
    const b = await snapshot(legacy);

    expect(a.rallySizeTotal).toBe(b.rallySizeTotal);
    expect(a.rallyFormula).toBe(b.rallyFormula);
    expect(a.squadFormula).toBe(b.squadFormula);
    expect(a.distHint).toBe(b.distHint);
    expect(numberMultiset(a.sendTable)).toBe(numberMultiset(b.sendTable));
    expect(a.grid9body).toBe(b.grid9body);
  });
}
