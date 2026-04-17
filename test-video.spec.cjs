const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const videoDir = path.join(__dirname, 'videos');
  if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: {
      dir: videoDir,
      size: { width: 1280, height: 800 }
    }
  });

  const page = await context.newPage();

  await page.goto('http://localhost:3000');
  await page.waitForTimeout(1000);

  // Home Page - Open widget settings
  await page.evaluate(() => {
    if(window.app && window.app.ui && typeof window.app.ui.showWidgetSettingsModal === 'function') {
      window.app.ui.showWidgetSettingsModal();
    }
  });
  await page.waitForTimeout(1000);

  // Close modal
  await page.evaluate(() => {
    const b = document.querySelector('#close-modal-btn');
    if(b) b.click();
  });
  await page.waitForTimeout(500);

  // Navigate to Records page via menu
  await page.evaluate(() => {
    const menus = document.querySelectorAll('#mobile-menu button, #desktop-sidebar button');
    for (const m of menus) {
       if(m.textContent.includes('明細')) { m.click(); break; }
    }
  });
  await page.waitForTimeout(1000);

  // Type in search
  await page.evaluate(() => {
    const input = document.getElementById('record-search-input');
    if(input) {
      input.value = '100';
      input.dispatchEvent(new Event('input'));
    }
  });
  await page.waitForTimeout(1000);

  // Navigate to Settings
  await page.evaluate(() => {
    const menus = document.querySelectorAll('#mobile-menu button, #desktop-sidebar button');
    for (const m of menus) {
       if(m.textContent.includes('設定')) { m.click(); break; }
    }
  });
  await page.waitForTimeout(500);

  // Enable Multi-Account mode directly in localStorage then reload
  await page.evaluate(() => {
    localStorage.setItem('EasyAccounting_settings', JSON.stringify({advancedMode: true}));
  });
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    const menus = document.querySelectorAll('#mobile-menu button, #desktop-sidebar button');
    for (const m of menus) {
       if(m.textContent.includes('帳戶')) { m.click(); break; }
    }
  });
  await page.waitForTimeout(1000);

  // Click Adjust Balance
  await page.evaluate(() => {
    const adjustBtns = document.querySelectorAll('.fa-scale-balanced');
    if(adjustBtns.length > 0) adjustBtns[0].parentElement.click();
  });
  await page.waitForTimeout(1500);

  await context.close();
  await browser.close();

  console.log('Video recorded to:', videoDir);
})();
