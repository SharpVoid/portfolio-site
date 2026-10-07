import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SITE_URL || 'http://localhost:4321';
const email = 'lisenkomike.v@gmail.com';
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/projects/doverie/', '/projects/focusml/', '/projects/design-arena/']) {
      await page.goto(base + route);
      const button = page.locator('[data-copy-email]');
      assert.equal(await page.locator('a[href^="mailto:"]').count(), 0);
      assert.equal(await button.innerText(), email);
      await button.click({ force: true });
      await page.waitForFunction(() => document.querySelector('[data-copy-email]').textContent === 'Почта скопирована ✓');
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), email);
      assert.equal(await button.locator('strong').innerText(), '✓');
      assert.equal(await button.evaluate(button => getComputedStyle(button).backgroundColor), 'rgba(0, 0, 0, 0)');
      assert.equal(await button.locator('span').evaluate(label => getComputedStyle(label).transitionDuration), '0.15s');
      assert.equal(new URL(page.url()).pathname, route);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      console.log(`PASS ${width}px ${route}: email copied, confirmation, no navigation or overflow`);
    }
  }
  const button = page.locator('[data-copy-email]');
  await page.waitForFunction(email => document.querySelector('[data-copy-email]').textContent === email, email);
  await button.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-copy-email]').textContent === 'Почта скопирована ✓');
  await page.keyboard.down('Space');
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-copy-email]')).transform.match(/matrix\(([^,]+)/)?.[1]) >= 1.099);
  assert.equal(await button.evaluate(button => getComputedStyle(button).transitionDuration), '0.14s');
  assert.equal(await button.evaluate(button => getComputedStyle(button).backgroundColor), 'rgba(0, 0, 0, 0)');
  await page.keyboard.up('Space');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), email);
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', {
    value: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')),
  }));
  await button.click({ force: true });
  await page.waitForFunction(() => document.querySelector('[data-copy-email]').textContent === 'Не удалось скопировать');
  assert.equal(await button.locator('strong').count(), 0);
  await page.waitForFunction(email => document.querySelector('[data-copy-email]').textContent === email, email);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await button.focus();
  await page.keyboard.down('Space');
  assert.equal(await button.evaluate(button => getComputedStyle(button).transform), 'none');
  await page.keyboard.up('Space');
  await page.waitForFunction(() => document.querySelector('[data-copy-email] span').style.transition === 'none');
  const resume = page.locator('.case-contact__resume');
  const [download] = await Promise.all([page.waitForEvent('download'), resume.click({ force: true })]);
  assert.equal(await download.failure(), null);
  await page.waitForFunction(() => document.querySelector('.case-contact__resume span').textContent === 'Резюме ✓');
  await page.waitForFunction(() => document.querySelector('.case-contact__resume span').textContent === 'Резюме');
  assert.deepEqual(errors, []);
  console.log('PASS keyboard, press animation without fill, label fade/reset, clipboard failure, reduced motion, resume download/feedback');
} finally { await browser.close(); }
