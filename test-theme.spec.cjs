const { test, expect } = require('@playwright/test');

test('Theme visual tests', async ({ page }) => {
  await page.goto('http://localhost:3000');

  // Wait for initial load
  await page.waitForTimeout(1000);

  // Navigate directly to themes page
  await page.goto('http://localhost:3000/#themes');
  await page.waitForTimeout(1000);

  // Take screenshot of Themes page in dark mode
  await page.screenshot({ path: '/tmp/file_attachments/theme-themes-dark.png', fullPage: true });

  // Clear theme
  await page.evaluate(() => {
    // Try to find the button
    const btns = Array.from(document.querySelectorAll('button'));
    const clearBtn = btns.find(b => b.textContent && b.textContent.includes('停用並恢復預設'));
    if (clearBtn) clearBtn.click();
  });
  await page.waitForTimeout(1000);

  // Take screenshot after clearing
  await page.screenshot({ path: '/tmp/file_attachments/theme-cleared.png', fullPage: true });

});
