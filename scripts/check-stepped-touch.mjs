// Real Chromium touch input (including native scroll/inertia), not synthetic DOM events.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const cdp = await page.context().newCDPSession(page);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const ids = ['about', 'problem', 'solution', 'shared-account', 'nearby'];
const pause = ms => page.waitForTimeout(ms);
async function state() {
  return page.evaluate(() => {
    const stage = document.querySelector('.case-stage.is-active');
    return { id: stage.dataset.caseStage, top: stage.getBoundingClientRect().top,
      y: scrollY, height: innerHeight, media: stage.querySelector('[data-stage-image]').dataset.active,
      count: document.querySelectorAll('.case-stage.is-active').length,
      overflow: document.documentElement.scrollWidth > innerWidth };
  });
}
async function expect(id) {
  const s = await state();
  assert.equal(s.id, id, JSON.stringify(s));
  assert.equal(s.media, 'true');
  assert.equal(s.count, 1);
  assert.equal(s.overflow, false);
  return s;
}
async function swipe(delta, moves = 6, delay = 20, settle = 1100) {
  const { width, height } = page.viewportSize();
  const y = delta > 0 ? height - 90 : 90;
  const x = width - 10; // Page gutter: does not activate native video controls.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= moves; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - delta * i / moves }] });
    await pause(delay);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pause(settle);
}
async function anchor(index, offset = 0) {
  await page.evaluate(({ index, offset }) => {
    document.documentElement.style.scrollBehavior = 'auto';
    const el = document.querySelectorAll('[data-case-stage]')[index];
    const top = index >= 3 ? 24 : Math.max(24, (innerHeight - el.offsetHeight) / 2);
    scrollTo(0, scrollY + el.getBoundingClientRect().top - top + offset);
  }, { index, offset });
  await pause(250);
}
try {
  await page.goto(process.env.SCROLL_URL || 'http://localhost:4322/projects/doverie/');
  await page.evaluate(() => document.fonts.ready);
  await anchor(0);
  const before = await expect('about');
  await swipe(20, 2);
  assert.equal((await expect('about')).y, before.y, 'short swipe is tension, not a skipped step');
  for (let i = 0; i < 3; i++) await swipe(20, 2);
  await expect('problem');
  await swipe(600, 2, 5);
  await expect('solution');
  await swipe(160);
  assert.ok(Math.abs((await expect('shared-account')).top - 24) <= 2);
  // Tall steps allow reading their lower text before advancing. No gesture skips a state.
  for (let i = 0; i < 8 && (await state()).id === 'shared-account'; i++) await swipe(300);
  assert.ok(Math.abs((await expect('nearby')).top - 24) <= 2);
  for (let i = 0; i < 6; i++) { await swipe(300); await expect('nearby'); }
  const outside = await state();
  assert.ok(outside.top < -500, 'last step releases ordinary scrolling to CTA');
  // Re-enter from below, then walk every state backwards.
  for (let i = 0; i < 8 && (await state()).top < -30; i++) await swipe(-220);
  await expect('nearby');
  await swipe(-140);
  assert.ok(Math.abs((await expect('shared-account')).top - 24) <= 2);
  await swipe(-600, 2, 5); await expect('solution');
  await swipe(-140); await expect('problem');
  await swipe(-140); await expect('about');
  const first = await state();
  await swipe(-250);
  assert.ok((await state()).y < first.y, 'first boundary releases to hero');
  // Native entry from above catches the first step even with momentum.
  await anchor(0, -350);
  await swipe(650, 2, 5); await expect('about');
  await swipe(140); await expect('problem');
  await page.setViewportSize({ width: 844, height: 390 });
  await pause(1200); await expect('problem');
  await page.setViewportSize({ width: 390, height: 844 });
  await pause(1200); await expect('problem');
  await swipe(140); await expect('solution');
  // A second deliberate gesture during settling is not the first gesture's inertia.
  await swipe(-140, 2, 5, 80); await expect('problem');
  await swipe(-140, 2, 5); await expect('about');
  await swipe(140); await expect('problem');
  await swipe(140); await expect('solution');
  // Cancellation cannot leave a gesture lock behind.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 380, y: 700 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 380, y: 680 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await swipe(-140); await expect('problem');
  await swipe(140); await expect('solution');
  await page.screenshot({ path: 'C:/Websites/doverie-touch-mobile.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await anchor(0);
  const reducedY = (await state()).y;
  await swipe(120);
  assert.ok((await state()).y > reducedY, 'reduced motion keeps native scrolling');
  assert.deepEqual(errors, []);
  console.log('PASS touch: both directions, short/fast, all five states, tall content, entry/exit, orientation, media sync, no overflow/console errors.');
} finally { await browser.close(); }
