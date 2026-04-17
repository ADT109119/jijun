const { test, expect } = require('@playwright/test');

test('Feature visual tests 2', async ({ page }) => {
  await page.goto('http://localhost:4173');
  await page.waitForTimeout(1000);

  // Navigate directly to accounts page
  await page.goto('http://localhost:4173/#accounts');
  await page.waitForTimeout(1000);

  // Take screenshot of Accounts page
  await page.screenshot({ path: '/tmp/file_attachments/feature-accounts2.png', fullPage: true });

  // Wait a little more if it's loading
  await page.waitForTimeout(1000);

  // Try to click adjust balance if we can find it
  await page.evaluate(() => {
    const btn = document.querySelector('.adjust-balance-btn');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1000);

  // Take screenshot of modal if open
  await page.screenshot({ path: '/tmp/file_attachments/feature-adjust-modal2.png', fullPage: true });
});
