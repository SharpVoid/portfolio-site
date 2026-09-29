// Optional development check: npm i --no-save playwright (not a runtime dependency).
// SCROLL_URL, PLAYWRIGHT_MODULE and CHROME_PATH can point to an existing setup.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const url = process.env.SCROLL_URL || 'http://localhost:4322/projects/doverie/';
const pause = (ms) => page.waitForTimeout(ms);
async function enter() {
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    const story = document.querySelector('[data-case-story]');
    scrollTo(0, story.getBoundingClientRect().top + scrollY - 300);
  });
  await pause(200);
}
async function state() {
  return page.evaluate(() => {
    const active = document.querySelector('.case-stage.is-active');
    const text = active.querySelector('.case-stage__content').getBoundingClientRect();
    const image = document.querySelector('.case-story__visual').getBoundingClientRect();
    const media = document.querySelector('[data-case-visual][data-active="true"] :is(img, video)').getBoundingClientRect();
    const sections = [...document.querySelectorAll('.case-stage__content')];
    const index = sections.indexOf(active.querySelector('.case-stage__content'));
    const before = sections[index - 1]?.getBoundingClientRect();
    const after = sections[index + 1]?.getBoundingClientRect();
    return {
      stage: active.dataset.caseStage,
      y: scrollY,
      center: Math.round(text.top + text.height / 2),
      visual: Math.round(image.top + image.height / 2),
      mediaCenter: media.top + media.height / 2,
      viewportCenter: innerHeight / 2,
      gapBefore: before ? text.top - before.bottom : null,
      gapAfter: after ? after.top - text.bottom : null,
      expectedGap: 150 + sections[0].offsetHeight * (1 - 0.6667),
      count: document.querySelectorAll('.case-stage.is-active').length,
    };
  });
}
async function expect(stage, centered = false) {
  const value = await state();
  assert.equal(value.stage, stage);
  assert.equal(value.count, 1);
  if (centered) {
    assert.ok(Math.abs(value.center - value.viewportCenter) <= 2, JSON.stringify(value));
    assert.ok(Math.abs(value.visual - value.viewportCenter) <= 2, JSON.stringify(value));
    assert.ok(Math.abs(value.mediaCenter - value.viewportCenter) <= 2, JSON.stringify(value));
    if (value.gapBefore !== null) assert.ok(Math.abs(value.gapBefore - value.expectedGap) <= 2, JSON.stringify(value));
    if (stage !== 'about' && value.gapAfter !== null) assert.ok(Math.abs(value.gapAfter - value.expectedGap) <= 2, JSON.stringify(value));
  }
  return value;
}
async function step(direction) {
  await page.mouse.wheel(0, direction * 60);
  await pause(30);
  await page.mouse.wheel(0, direction * 60);
  await pause(1100);
}
try {
  await enter();
  const initial = await expect('about');
  assert.ok(Math.abs(initial.center - initial.mediaCenter) <= 2, JSON.stringify(initial));
  await page.mouse.wheel(0, 20);
  await pause(200);
  const tension = await expect('about');
  assert.equal(tension.y, initial.y);
  assert.ok(tension.center < initial.center);
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 20);
    await pause(180);
  }
  await pause(1100);
  await expect('problem', true);
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, 60);
    await pause(15);
  }
  await pause(1100);
  await expect('solution', true);
  await step(1); await expect('shared-account', true);
  assert.equal(await page.locator('[data-case-visual="shared-account"] video').evaluate(v => v.paused), false);
  await step(1); await expect('nearby', true);
  const lastY = (await state()).y;
  await page.mouse.wheel(0, 80);
  await pause(300);
  assert.ok((await state()).y > lastY, 'last boundary must release native scrolling');
  await step(-1);
  await expect('shared-account', true);
  await step(-1); await expect('solution', true);
  await step(-1);
  await expect('problem', true);
  await step(-1);
  await expect('about', true);
  const firstY = (await state()).y;
  await page.mouse.wheel(0, -80);
  await pause(300);
  assert.ok((await state()).y < firstY, 'first boundary must release native scrolling');

  // A fast gesture on the FIRST step must stop on the second, never the third.
  await enter();
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, i === 10 ? -5 : 60);
    await pause(15);
  }
  await pause(1100);
  await expect('problem', true);

  // Light opposite input does not cancel an in-flight position animation.
  await enter();
  await page.mouse.wheel(0, 60); await pause(30);
  await page.mouse.wheel(0, 60); await pause(170);
  await page.mouse.wheel(0, -8); await pause(1100);
  await expect('problem', true);

  // Opening a preview from an off-anchor native position must not freeze that offset.
  await page.evaluate(() => scrollBy(0, 220));
  await pause(200);
  await page.locator('[data-case-visual="problem"] img').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await pause(1200);
  await expect('problem', true);

  // A normal content click must not strand the settling scroll halfway.
  await enter();
  await page.mouse.wheel(0, 60); await pause(30);
  await page.mouse.wheel(0, 60); await pause(80);
  await page.mouse.click(110, 400);
  await pause(1200);
  await expect('problem', true);

  await page.setViewportSize({ width: 1200, height: 800 });
  await pause(1200);
  await expect('problem', true);
  await step(-1); await expect('about');
  await step(1); await expect('problem', true);
  await page.setViewportSize({ width: 1920, height: 700 });
  await pause(300);
  await step(-1); await expect('about');
  await step(1); await expect('problem', true);
  assert.equal(await page.locator('.case-contact').evaluate(el => getComputedStyle(el).marginTop), '226.5px');
  assert.equal(await page.locator('.case-project-nav').evaluate(el => getComputedStyle(el).marginTop), '72px');
  for (const width of [800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await pause(1200); // Mobile now restores its active anchor after resize.
    assert.equal(await page.locator('.case-story__visual').evaluate(
      (el) => getComputedStyle(el).display), 'none');
    const y = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 50); await pause(250);
    assert.ok(await page.evaluate((old) => scrollY > old, y));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enter();
  const y = (await state()).y;
  await page.mouse.wheel(0, 20); await pause(250);
  assert.ok((await state()).y > y, 'reduced motion uses native scrolling');
  assert.ok(await page.locator('video').evaluateAll(videos => videos.every(v => v.paused)), 'reduced motion disables autoplay');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  assert.equal(await page.locator('.case-project-nav').evaluate(el => getComputedStyle(el).marginTop), '150px');
  await page.locator('.case-tags__toggle').click();
  assert.equal(await page.locator('.case-tags__toggle').getAttribute('aria-expanded'), 'true');
  for (const section of await page.locator('[data-case-stage]').all()) {
    await section.scrollIntoViewIfNeeded();
    await pause(200);
    const image = section.locator('.case-stage__mobile-visual img');
    if (await image.count()) await image.evaluate(img => img.decode());
  }
  assert.deepEqual(errors, []);
  console.log('PASS: slow/fast, all steps, both boundaries, jitter, interrupted input, resize, mobile/tablet, reduced motion.');
} finally {
  await browser.close();
}
