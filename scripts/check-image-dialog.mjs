import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  for (const width of [1440, 390, 768]) {
    const mobile = width <= 900;
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: mobile });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.SCROLL_URL || 'http://localhost:4322/projects/doverie/');
    await page.evaluate(() => document.fonts.ready);
    const dialog = page.locator('.case-image-dialog');
    for (const id of ['problem', 'solution']) {
      await page.evaluate(id => {
        document.documentElement.style.scrollBehavior = 'auto';
        const stage = document.querySelector(`[data-case-stage="${id}"]`);
        const height = innerWidth > 900 ? stage.querySelector('.case-stage__content').offsetHeight : stage.offsetHeight;
        scrollTo(0, scrollY + stage.getBoundingClientRect().top - Math.max(24, (innerHeight - height) / 2));
      }, id);
      await page.waitForTimeout(500);
      const image = page.locator(mobile ? `[data-stage-image="${id}"] img` : `[data-case-visual="${id}"] img`);
      await image.focus();
      await page.keyboard.press('Enter');
      assert.equal(await dialog.evaluate(el => el.open), true);
      await dialog.locator('img').evaluate(el => el.decode());
      assert.equal(await dialog.locator('img').getAttribute('alt'), await image.getAttribute('alt'));
      assert.deepEqual(await dialog.locator('.case-image-dialog__close').evaluate(el => {
        const style = getComputedStyle(el);
        return [style.backgroundColor, style.color];
      }), ['rgb(0, 117, 226)', 'rgb(255, 255, 255)']);
      assert.equal(await dialog.evaluate(el => getComputedStyle(el).borderRadius), mobile ? '20px' : '30px');
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
      if (mobile) {
        assert.equal(await dialog.evaluate(el => getComputedStyle(el).padding), '0px');
        assert.equal(await dialog.evaluate(el => getComputedStyle(el).borderWidth), '0px');
        const viewport = dialog.locator('.case-image-dialog__viewport');
        const initial = await dialog.locator('img').boundingBox();
        assert.ok(Math.abs(initial.x - box.x) < 1 && Math.abs(initial.y - box.y) < 1);
        const plus = dialog.getByRole('button', { name: 'Увеличить изображение', exact: true });
        const minus = dialog.getByRole('button', { name: 'Уменьшить изображение', exact: true });
        const zoomPosition = await dialog.locator('.case-image-dialog__zoom').boundingBox();
        const minusPosition = await minus.boundingBox();
        const plusPosition = await plus.boundingBox();
        assert.ok(Math.abs(minusPosition.x - plusPosition.x) < 1 && plusPosition.y < minusPosition.y, 'Zoom in sits above zoom out');
        assert.equal(await minus.isDisabled(), true);
        for (let step = 0; step < 6; step++) await plus.tap();
        assert.equal(await plus.isDisabled(), true);
        const enlarged = await dialog.locator('img').boundingBox();
        assert.ok(Math.abs(enlarged.width / initial.width - 4) < 0.01);
        assert.ok(Math.abs(enlarged.height / initial.height - 4) < 0.01);
        const enlargedWindow = await dialog.boundingBox();
        assert.deepEqual(await dialog.locator('.case-image-dialog__zoom').boundingBox(), zoomPosition, 'Zoom controls stay fixed while the window grows');
        assert.ok(enlargedWindow.width > box.width + 1 || enlargedWindow.height > box.height + 1, 'Preview window grows with the image');
        assert.ok(Math.abs(enlargedWindow.width - Math.min(initial.width * 4, width - 32)) < 1);
        assert.ok(Math.abs(enlargedWindow.height - Math.min(initial.height * 4, 900 - 32)) < 1);
        assert.equal(await dialog.evaluate(el => el.open), true);
        const beforePan = await viewport.evaluate(el => [el.scrollLeft, el.scrollTop]);
        const touch = await page.context().newCDPSession(page);
        const center = { x: enlargedWindow.x + enlargedWindow.width / 2, y: enlargedWindow.y + enlargedWindow.height * 0.75 };
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center] });
        for (let step = 1; step <= 5; step++) {
          await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x - step * 16, y: center.y - step * 10 }] });
          await page.waitForTimeout(30);
        }
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(250);
        await touch.detach();
        const afterPan = await viewport.evaluate(el => [el.scrollLeft, el.scrollTop]);
        assert.ok(afterPan.some((offset, index) => offset !== beforePan[index]), 'Touch pans the enlarged image');
        assert.equal(await page.evaluate(() => scrollY), y);
        for (let step = 0; step < 6; step++) await minus.tap();
        assert.equal(await minus.isDisabled(), true);
        assert.deepEqual(await viewport.evaluate(el => [el.scrollLeft, el.scrollTop]), [0, 0]);
        assert.ok(Math.abs((await dialog.locator('img').boundingBox()).width - initial.width) < 1);
        const restoredWindow = await dialog.boundingBox();
        assert.deepEqual(await dialog.locator('.case-image-dialog__zoom').boundingBox(), zoomPosition, 'Zoom controls stay fixed while the window shrinks');
        assert.ok(Math.abs(restoredWindow.width - box.width) < 1 && Math.abs(restoredWindow.height - box.height) < 1, 'Window shrinks back at 1x');
        await dialog.locator('img').tap();
        assert.equal(await dialog.evaluate(el => el.open), true, 'Touching the image does not close mobile preview');
      } else {
        assert.equal(await dialog.locator('.case-image-dialog__zoom').isVisible(), false);
      }
      if (id === 'solution') await page.screenshot({ path: `C:/Websites/portfolio-site/.artifacts/case-preview-${width}.png` });
      await page.keyboard.press('Escape');
      assert.equal(await dialog.evaluate(el => el.open), false);
      assert.equal(await image.evaluate(el => el === document.activeElement), true);
      if (mobile) await image.tap(); else await image.click();
      assert.equal(await dialog.evaluate(el => el.style.getPropertyValue('--preview-zoom') || '1'), '1');
      await dialog.locator('.case-image-dialog__close').click();
      assert.equal(await dialog.evaluate(el => el.open), false);
      await image.click();
      await page.mouse.click(2, 2);
      assert.equal(await dialog.evaluate(el => el.open), false);
      assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
      await page.waitForTimeout(100); // Closing preserves native scroll position.
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS image dialog: desktop/mobile/tablet, keyboard/tap, 1–4x zoom, touch pan, focus return, backdrop/Escape/close button, no scroll leakage or overflow.');
} finally { await browser.close(); }
