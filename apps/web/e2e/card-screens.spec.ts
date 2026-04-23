import { test } from '@playwright/test';

const OUT = '/tmp/invoice-screens';

test.describe.configure({ mode: 'serial' });

test('capture card buttons + Add/Request dialogs', async ({ page }) => {
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

  await page.goto('/customers');
  await page.waitForSelector('h1');
  await page.waitForLoadState('networkidle').catch(() => {});

  const firstCustomerLink = page.locator('table tbody tr a[href^="/customers/"]').first();
  const href = await firstCustomerLink.getAttribute('href');
  if (!href) throw new Error('No customer link found on list page');

  await page.goto(href);
  await page.waitForSelector('h1');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);

  const btnAdd = page.locator('button:has-text("Add card")').first();
  await btnAdd.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  await page.screenshot({ path: `${OUT}/10-customer-with-card-buttons.png`, fullPage: true });

  const box = await btnAdd.boundingBox();
  if (box) {
    const pad = 60;
    await page.screenshot({
      path: `${OUT}/11-card-buttons-zoom.png`,
      clip: {
        x: Math.max(0, box.x - 520),
        y: Math.max(0, box.y - pad),
        width: Math.min(1440, box.width + 600),
        height: box.height + pad * 2,
      },
    });
  }

  await btnAdd.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/12-add-card-dialog.png`, fullPage: true });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const closeBtn = page.locator('button:has-text("Cancel"), button:has-text("Close")').first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(300);
  }

  const btnRequest = page.locator('button:has-text("Request card")').first();
  await btnRequest.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/13-request-card-dialog.png`, fullPage: true });
});
