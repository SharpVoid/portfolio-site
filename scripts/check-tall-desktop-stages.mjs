// Run against the background preview: node scripts/check-tall-desktop-stages.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'msedge' }) });
const page = await browser.newPage({ viewport: { width: 901, height: 400 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const base = process.env.SITE_URL || 'http://localhost:4321';
const pause = ms => page.waitForTimeout(ms);
const state = () => page.evaluate(() => {
  const stage = document.querySelector('.case-stage.is-active');
  const text = stage.querySelector('.case-stage__content').getBoundingClientRect();
  return { id: stage.dataset.caseStage, top: text.top, bottom: text.bottom, height: text.height,
    y: scrollY, viewport: innerHeight,
    media: document.querySelector('[data-case-visual][data-active="true"]').dataset.caseVisual };
});
async function step(direction) {
  await page.mouse.wheel(0, direction * 60);
  await pause(30);
  await page.mouse.wheel(0, direction * 60);
  await pause(1100);
}
async function readTall(direction) {
  const before = await state();
  if (before.height <= before.viewport - 48) return;
  assert.ok(direction > 0 ? before.top >= 23 : before.bottom <= before.viewport - 23, JSON.stringify(before));
  await page.mouse.wheel(0, direction * 20);
  await pause(200);
  const partial = await state();
  assert.equal(partial.id, before.id);
  assert.ok(direction * (partial.y - before.y) > 0, 'scroll through text before changing step');
  await page.mouse.wheel(0, direction * 1200);
  // Momentum in the same gesture cannot skip the reading boundary.
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, direction * 60); await pause(15); }
  await pause(250);
  const after = await state();
  assert.equal(after.id, before.id);
  assert.equal(after.media, before.id);
  assert.ok(direction > 0 ? after.bottom <= after.viewport - 23 : after.top >= 23, JSON.stringify(after));
}
try {
  for (const route of ['focusml', 'doverie', 'design-arena']) {
    await page.goto(`${base}/projects/${route}/`);
    await page.evaluate(() => document.fonts.ready);
    const ids = await page.locator('[data-case-stage]').evaluateAll(nodes => nodes.map(n => n.dataset.caseStage));
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      const stage = document.querySelector('[data-case-stage]');
      const text = stage.querySelector('.case-stage__content');
      scrollTo(0, scrollY + stage.getBoundingClientRect().top - Math.max(24, (innerHeight - text.offsetHeight) / 2));
    });
    await pause(300);
    for (let i = 0; i < ids.length; i++) {
      const current = await state();
      assert.equal(current.id, ids[i]);
      assert.equal(current.media, ids[i]);
      await readTall(1);
      if (i < ids.length - 1) await step(1);
    }
    for (let i = ids.length - 1; i >= 0; i--) {
      assert.equal((await state()).id, ids[i]);
      await readTall(-1);
      if (i) await step(-1);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log(`PASS ${route}: every heading and final line, both directions, fast gestures at 901 × 400`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
