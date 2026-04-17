const { test, expect } = require('@playwright/test');

test('Feature visual tests', async ({ page }) => {
  // Start recording video
  await page.goto('http://localhost:4173');

  // Wait for initial load
  await page.waitForTimeout(1000);

  // Take screenshot of Home page
  await page.screenshot({ path: '/tmp/file_attachments/feature-home.png', fullPage: true });

  // Open Widget Modal
  await page.evaluate(() => {
    document.getElementById('manage-widgets-btn')?.click();
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/file_attachments/feature-widget-modal.png', fullPage: true });

  // Close Widget Modal
  await page.evaluate(() => {
    document.getElementById('close-widget-modal')?.click();
  });
  await page.waitForTimeout(500);

  // Navigate to Records page
  await page.goto('http://localhost:4173/#records');
  await page.waitForTimeout(1000);

  // Take screenshot of Records page with search
  await page.screenshot({ path: '/tmp/file_attachments/feature-records.png', fullPage: true });

  // Navigate to Settings page
  await page.goto('http://localhost:4173/#settings');
  await page.waitForTimeout(1000);

  // Click on "Account Management"
  await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    const accountsLink = links.find(l => l.href.includes('#accounts'));
    if (accountsLink) accountsLink.click();
  });
  await page.waitForTimeout(1000);

  // Take screenshot of Accounts page
  await page.screenshot({ path: '/tmp/file_attachments/feature-accounts.png', fullPage: true });

  // Click on "Adjust Balance" icon
  await page.evaluate(() => {
    document.querySelector('.adjust-balance-btn')?.click();
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/file_attachments/feature-adjust-modal.png', fullPage: true });
});
