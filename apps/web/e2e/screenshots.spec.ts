import { test } from '@playwright/test';

const OUT = '/tmp/invoice-screens';

test.describe.configure({ mode: 'serial' });

test('capture invoice list + every invoice detail', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);

  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/login');
  await page.fill('input[name="email"]', 'admin@raccooncrm.local');
  await page.fill('input[name="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(scheduler|auth\/change-password)/);
  if (page.url().includes('change-password')) {
    await page.goto('/scheduler');
  }

  await page.goto('/customers/invoices');
  await page.waitForSelector('h1');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/00-list.png`, fullPage: true });

  const hrefs = await page
    .locator('table tbody tr a[href^="/invoices/"]')
    .evaluateAll((els) =>
      Array.from(new Set(els.map((e) => (e as HTMLAnchorElement).getAttribute('href')).filter(Boolean) as string[])),
    );

  console.log(`found ${hrefs.length} invoice links:`, hrefs);

  let i = 0;
  for (const href of hrefs) {
    i += 1;
    const id = href.split('/').pop() ?? `x${i}`;
    await page.goto(href);
    await page.waitForSelector('h1');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/02-detail-${String(i).padStart(2, '0')}-${id}.png`, fullPage: true });
  }
});
