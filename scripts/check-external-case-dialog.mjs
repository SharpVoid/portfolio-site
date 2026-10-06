import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  await mkdir('.artifacts', { recursive: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 390 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Stub the destination so the check never depends on the external site.
    await page.route('https://www.consulai.ru/**', route => route.fulfill({ body: 'ConsulAI' }));
    const home = process.env.PORTFOLIO_URL || 'http://localhost:4321/';
    await page.goto(home);
    await page.evaluate(async () => {
      await document.fonts.ready;
      document.documentElement.style.scrollBehavior = 'auto';
    });
    const link = page.locator('#atomreport .project-card__link');
    const dialog = page.locator('#external-case-dialog');
    assert.equal(await link.getAttribute('target'), null);
    await link.scrollIntoViewIfNeeded();
    await link.focus();
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await dialog.evaluate(el => getComputedStyle(el).borderRadius), width === 390 ? '20px' : '30px');
    assert.equal(await dialog.evaluate(el => getComputedStyle(el, '::backdrop').backgroundColor), 'rgba(0, 0, 0, 0.5)');
    assert.equal(page.url(), home);
    assert.equal(await dialog.locator('p').textContent(), 'Вы переходите на публичный сайт ConsulAI');
    assert.equal(await dialog.locator('button').first().evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await dialog.locator('button').last().evaluate(el => el === document.activeElement), true);
    await link.focus();
    assert.equal(await dialog.locator('button').last().evaluate(el => el === document.activeElement), true);
    const y = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => scrollY), y);
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 900);
    await page.screenshot({ path: `.artifacts/consulai-dialog-${width}.png` });
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(page.url(), home);
    assert.equal(await link.evaluate(el => el === document.activeElement), true);
    if (width === 390) await link.tap(); else await link.click();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(page.url(), home);
    await link.click();
    await page.mouse.click(2, 2);
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), 'visible');
    await link.click();
    await dialog.getByRole('button', { name: 'Окей', exact: true }).click();
    await page.waitForURL('https://www.consulai.ru/');
    assert.equal(context.pages().length, 1);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS ConsulAI dialog: desktop/mobile, text, keyboard/tap, focus trap/return, cancel/Escape/backdrop, scroll lock, same-tab navigation.');
} finally { await browser.close(); }
