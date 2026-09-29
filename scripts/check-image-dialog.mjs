import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width === 390 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.SCROLL_URL || 'http://localhost:4322/projects/doverie/');
    await page.evaluate(() => document.fonts.ready);
    const dialog = page.locator('.case-image-dialog');
    for (const id of ['problem', 'solution']) {
      await page.evaluate(id => {
        document.documentElement.style.scrollBehavior = 'auto';
        const stage = document.querySelector(`[data-case-stage="${id}"]`);
        scrollTo(0, scrollY + stage.getBoundingClientRect().top - 24);
      }, id);
      await page.waitForTimeout(500);
      const image = page.locator(width === 390 ? `[data-stage-image="${id}"] img` : `[data-case-visual="${id}"] img`);
      await image.focus();
      await page.keyboard.press('Enter');
      assert.equal(await dialog.evaluate(el => el.open), true);
      await dialog.locator('img').evaluate(el => el.decode());
      assert.equal(await dialog.locator('img').getAttribute('alt'), await image.getAttribute('alt'));
      assert.equal(await dialog.evaluate(el => getComputedStyle(el).borderRadius), '30px');
      assert.equal(await dialog.evaluate(el => getComputedStyle(el, '::backdrop').backgroundColor), 'rgba(0, 0, 0, 0.5)');
      const y = await page.evaluate(() => scrollY);
      const active = await page.locator('.case-stage.is-active').getAttribute('data-case-stage');
      await page.mouse.wheel(0, 500);
      await page.keyboard.press('PageDown');
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => scrollY), y);
      assert.equal(await page.locator('.case-stage.is-active').getAttribute('data-case-stage'), active);
      const box = await dialog.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 900);
      if (id === 'solution') await page.screenshot({ path: `C:/Websites/doverie-dialog-${width}.png` });
      await page.keyboard.press('Escape');
      assert.equal(await dialog.evaluate(el => el.open), false);
      assert.equal(await image.evaluate(el => el === document.activeElement), true);
      if (width === 390) await image.tap(); else await image.click();
      await dialog.locator('button').click();
      assert.equal(await dialog.evaluate(el => el.open), false);
      await image.click();
      await page.mouse.click(2, 2);
      assert.equal(await dialog.evaluate(el => el.open), false);
      assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
      await page.waitForTimeout(1200); // Desktop resumes the active step's centering spring.
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS image dialog: desktop/mobile, keyboard/tap, focus return, backdrop/Escape/close button, no scroll leakage or overflow.');
} finally { await browser.close(); }
