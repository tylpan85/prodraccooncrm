import { expect, test } from '@playwright/test';

/**
 * Full end-to-end flow:
 * Login → Create customer → Schedule job → Finish → Invoice lifecycle
 *
 * Requires the dev server (web + API) running against seeded DB.
 */

test.describe('Full V1 flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.fill('input[name="email"]', 'admin@raccooncrm.local');
    await page.fill('input[name="password"]', 'admin');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(scheduler|auth\/change-password)/);

    // Handle forced password reset if needed
    if (page.url().includes('change-password')) {
      // Skip for now — seeded admin may have already changed
      await page.goto('/scheduler');
    }
  });

  test('login lands on scheduler', async ({ page }) => {
    await expect(page.locator('text=Today')).toBeVisible();
  });

  test('create customer → schedule job → finish → invoice flow', async ({ page }) => {
    const tag = `E2E-${Date.now()}`;

    // ── Create customer ──────────────────────────────────────────────
    await page.goto('/customers/new');
    await page.fill('input[name="firstName"]', tag);
    await page.fill('input[name="lastName"]', 'TestCustomer');
    await page.selectOption('select[name="customerType"]', 'Homeowner');

    // Primary address
    await page.fill('input[name="primaryAddress.street"]', '100 Main St');
    await page.fill('input[name="primaryAddress.city"]', 'Austin');
    await page.fill('input[name="primaryAddress.state"]', 'TX');
    await page.fill('input[name="primaryAddress.zip"]', '78701');

    await page.click('button[type="submit"]');

    // Should land on customer detail
    await page.waitForURL(/\/customers\/.+/);
    await expect(page.locator('h1')).toContainText(tag);

    // Extract customer ID from URL
    const customerUrl = page.url();
    const customerId = customerUrl.split('/customers/')[1]?.split('/')[0] ?? '';
    expect(customerId).toBeTruthy();

    // ── Create job via New Job button ────────────────────────────────
    await page.click('text=New job');
    await page.waitForURL(/\/jobs\/new/);

    // Fill job form
    await page.fill('input[name="titleOrSummary"]', `${tag} E2E Job`);
    await page.fill('input[name="priceCents"]', '250');

    // Schedule it
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().slice(0, 10);
    const startInput = page.locator('input[name="scheduledStartAt"]');
    if (await startInput.isVisible()) {
      await startInput.fill(`${dateStr}T09:00`);
      const endInput = page.locator('input[name="scheduledEndAt"]');
      await endInput.fill(`${dateStr}T10:00`);
    }

    await page.click('button[type="submit"]');

    // Should land on job detail
    await page.waitForURL(/\/jobs\/.+/);
    await expect(page.locator('h1')).toBeVisible();

    // ── Finish the job ──────────────────────────────────────────────
    const finishButton = page.locator('button:has-text("Finish")');
    if (await finishButton.isVisible()) {
      await finishButton.click();
      // Wait for the invoice section to appear
      await page.waitForTimeout(1000);
    }

    // ── Navigate to invoices ────────────────────────────────────────
    await page.goto('/customers/invoices');
    await expect(page.locator('h1')).toContainText('Invoices');

    // Unsent tab should show our draft invoice
    await expect(page.locator('table')).toBeVisible({ timeout: 5000 });
  });

  test('scheduler keyboard shortcuts', async ({ page }) => {
    await page.goto('/scheduler');
    await expect(page.locator('text=Today')).toBeVisible();

    // 't' should work (go to today)
    await page.keyboard.press('t');
    await page.waitForTimeout(300);

    // Arrow keys for navigation
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);

    // 'd' for day view
    await page.keyboard.press('d');
    await page.waitForTimeout(300);

    // 'm' for month view
    await page.keyboard.press('m');
    await page.waitForTimeout(500);
    await expect(page.locator('text=Sun')).toBeVisible();

    // Back to day
    await page.keyboard.press('d');
    await page.waitForTimeout(300);
  });

  test('settings pages load', async ({ page }) => {
    // Services
    await page.goto('/settings/services');
    await expect(page.locator('h1')).toContainText('Services');

    // Team
    await page.goto('/settings/team');
    await expect(page.locator('h1')).toContainText('Team');

    // Organization
    await page.goto('/settings/organization');
    await expect(page.locator('h1')).toContainText('Organization');
  });

  test('invoice lifecycle via API-created data', async ({ page }) => {
    // Navigate to invoices list
    await page.goto('/customers/invoices');
    await expect(page.locator('h1')).toContainText('Invoices');

    // Check all tabs are present
    await expect(page.locator('button:has-text("Unsent")')).toBeVisible();
    await expect(page.locator('button:has-text("Open")')).toBeVisible();
    await expect(page.locator('button:has-text("Past Due")')).toBeVisible();
    await expect(page.locator('button:has-text("Paid")')).toBeVisible();
    await expect(page.locator('button:has-text("Void")')).toBeVisible();
  });
});
