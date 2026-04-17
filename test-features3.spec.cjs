const { test, expect } = require('@playwright/test');

test('Feature visual tests 3', async ({ page }) => {
  await page.goto('http://localhost:4173');
  await page.waitForTimeout(1000);

  // Navigate to settings and enable accounts
  await page.goto('http://localhost:4173/#settings');
  await page.waitForTimeout(1000);

  // Enable advanced mode
  await page.evaluate(() => {
     // Find the toggle for accounts
     const labels = Array.from(document.querySelectorAll('.setting-item label'));
     const multiAccount = labels.find(l => l.textContent.includes('多帳戶模式'));
     if (multiAccount) {
         const toggle = multiAccount.parentElement.querySelector('input[type="checkbox"]');
         if(toggle && !toggle.checked) toggle.click();
     }
  });
  await page.waitForTimeout(1000);

  // Now go to accounts page
  await page.goto('http://localhost:4173/#accounts');
  await page.waitForTimeout(1000);

  // Click add account button
  await page.evaluate(() => {
      document.getElementById('add-account-btn')?.click();
  });
  await page.waitForTimeout(1000);

  // Fill and save account
  await page.evaluate(() => {
     const input = document.getElementById('account-name-input');
     if(input) {
         input.value = 'My Bank';
         document.getElementById('save-account-btn')?.click();
     }
  });
  await page.waitForTimeout(1000);

  // Take screenshot of Accounts page
  await page.screenshot({ path: '/tmp/file_attachments/feature-accounts3.png', fullPage: true });

  // Try to click adjust balance
  await page.evaluate(() => {
    const btn = document.querySelector('.adjust-balance-btn');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1000);

  // Take screenshot of modal if open
  await page.screenshot({ path: '/tmp/file_attachments/feature-adjust-modal3.png', fullPage: true });
});
