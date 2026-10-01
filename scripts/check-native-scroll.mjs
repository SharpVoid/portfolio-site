// node scripts/check-native-scroll.mjs [--capture-before]
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const before = process.argv.includes('--capture-before');
const dir = process.env.SCROLL_SNAPSHOT_DIR || 'C:/Websites/work/native-scroll';
const base = process.env.SITE_URL || 'http://localhost:4321';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'msedge' }) });
const errors = [];
const signatures = page => page.evaluate(() => ({
  active: document.querySelector('.case-stage.is-active').dataset.caseStage,
  media: document.querySelector('[data-case-visual][data-active="true"]').dataset.caseVisual,
  progress: Number(document.querySelector('[data-case-story]').style.getPropertyValue('--case-scroll-progress')),
}));
async function jump(page, y) {
  await page.evaluate(y => { scrollTo({ top: y, behavior: 'instant' }); window.__appScrollWrites = []; }, y);
  await page.waitForTimeout(80);
}
async function checkInput(page, width) {
  const start = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 50);
  await page.waitForTimeout(160);
  const after = await page.evaluate(() => scrollY);
  assert.ok(Math.abs(after - start - 50) < 2, 'wheel delta must reach native scroll unchanged');
  const fastDelta = await page.evaluate(y => Math.min(1800, document.documentElement.scrollHeight - innerHeight - y - 50), after);
  await page.mouse.wheel(0, fastDelta);
  await page.waitForTimeout(200);
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - after - fastDelta) < 2, 'fast wheel must not be trapped at one step');
  await page.mouse.wheel(0, -fastDelta);
  await page.waitForTimeout(200);
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - after) < 2, 'reverse wheel remains native');
  // Trackpad-sized input: the browser consumes every tick without a gesture lock.
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 8); await page.waitForTimeout(16); }
  await page.waitForTimeout(160);
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - after - 96) < 2);
  if (width <= 900) {
    const client = await page.context().newCDPSession(page);
    const y = await page.evaluate(() => scrollY);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 650 }] });
    for (let step = 1; step <= 5; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y: 650 - step * 35 }] });
      await page.waitForTimeout(30);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(800);
    assert.ok(await page.evaluate(y => scrollY > y + 80, y), 'real touch input must scroll natively');
    await client.detach();
  }
  const recorded = await page.evaluate(() => ({ canceled: window.__canceledScroll, writes: window.__appScrollWrites, handlers: window.__scrollHandlers }));
  assert.deepEqual(recorded, { canceled: [], writes: [], handlers: [] });
}
try {
  for (const width of (before ? [1440, 390] : [1440, 1920, 901, 800, 390])) {
    for (const route of ['focusml', 'doverie', 'design-arena']) {
      const page = await browser.newPage({ viewport: { width, height: width === 901 ? 400 : 900 }, hasTouch: width <= 900 });
      page.on('pageerror', error => errors.push(error.message));
      if (!before) await page.addInitScript(() => {
        window.__appScrollWrites = []; window.__canceledScroll = []; window.__scrollHandlers = [];
        for (const type of ['wheel', 'touchmove']) window.addEventListener(type, event => {
          queueMicrotask(() => { if (event.defaultPrevented) window.__canceledScroll.push(type); });
        }, { passive: true });
        const add = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, ...args) {
          if (['wheel', 'touchmove'].includes(type)) window.__scrollHandlers.push(type);
          return add.call(this, type, ...args);
        };
        for (const method of ['scrollTo', 'scrollBy', 'scroll']) {
          const original = window[method];
          window[method] = function(...args) { window.__appScrollWrites.push(method); return original.apply(this, args); };
        }
      });
      await page.goto(`${base}/projects/${route}/`);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(i => { i.loading = 'eager'; return i.decode().catch(() => {}); }));
        document.documentElement.style.scrollBehavior = 'auto';
      });
      const count = await page.locator('[data-case-stage]').count();
      const snapshots = [];
      for (let index = 0; index < count; index++) {
        await page.evaluate(index => {
          const stage = document.querySelectorAll('[data-case-stage]')[index];
          const height = innerWidth <= 900 ? stage.offsetHeight : stage.querySelector('.case-stage__content').offsetHeight;
          const top = innerWidth <= 900 && stage.dataset.mobileAlign === 'top' ? 24 : Math.max(24, (innerHeight - height) / 2);
          scrollTo(0, scrollY + stage.getBoundingClientRect().top - top);
        }, index);
        if (!before) await page.evaluate(() => { window.__appScrollWrites = []; });
        await page.waitForTimeout(600);
        snapshots.push(await page.evaluate(() => {
          const active = document.querySelector('.case-stage.is-active');
          const rect = active.querySelector('.case-stage__content').getBoundingClientRect();
          return { id: active.dataset.caseStage, text: [rect.x, rect.y, rect.width, rect.height], y: scrollY };
        }));
        if (!before) {
          const ids = await page.locator('[data-case-stage]').evaluateAll(nodes => nodes.map(n => n.dataset.caseStage));
          const state = await signatures(page);
          assert.equal(state.active, ids[index], `${route}/${width}: resting stage ${index}`);
          assert.equal(state.media, ids[index], 'copy/media must agree');
          const y = await page.evaluate(() => scrollY);
          const geometry = await page.locator('[data-case-stage]').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().top + scrollY));
          await jump(page, y + 140);
          await jump(page, y);
          assert.deepEqual(await signatures(page), state, 'same scroll position produces the same state in reverse');
          assert.deepEqual(await page.locator('[data-case-stage]').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().top + scrollY)), geometry,
            'changing visual state must not move layout markers');
          const text = snapshots.at(-1).text;
          if (width > 900) assert.ok(Math.abs(text[1] - Math.max(24, (await page.evaluate(() => innerHeight) - text[3]) / 2)) < 2,
            'resting text retains its original centered composition');
          const reading = await page.locator('[data-case-stage]').nth(index).evaluate(n => ({
            height: n.querySelector('.case-stage__content').offsetHeight, viewport: innerHeight,
          }));
          if (width > 900 && reading.height > reading.viewport - 48) {
            await jump(page, y + reading.height - reading.viewport + 48);
            assert.equal((await signatures(page)).active, ids[index], 'tall text stays active through its full reading range');
            assert.ok(await page.locator('[data-case-stage]').nth(index).evaluate(n =>
              Math.abs(n.querySelector('.case-stage__content').getBoundingClientRect().bottom - innerHeight + 24) < 2));
            await jump(page, y);
          }
        }
        await page.screenshot({ path: `${dir}/${before ? 'before' : 'after'}-${route}-${width}-${index}.png`,
          mask: [page.locator('[data-case-visual][data-active="true"] video, .case-stage__mobile-visual video:visible'), page.locator('[data-moscow-clock]')] });
      }
      await writeFile(`${dir}/${before ? 'before' : 'after'}-${route}-${width}.json`, JSON.stringify(snapshots, null, 2));
      if (!before) {
        // Compare original geometry where a baseline exists; gaps are deliberately stable now.
        const baseline = await readFile(`${dir}/before-${route}-${width}.json`, 'utf8').then(JSON.parse).catch(() => null);
        if (baseline) for (let i = 0; i < count; i++) {
          assert.equal(snapshots[i].id, baseline[i].id);
          for (const coordinate of [0, 2, 3]) assert.ok(Math.abs(snapshots[i].text[coordinate] - baseline[i].text[coordinate]) < 4,
            `${route}/${width}/${i}: text dimensions differ from baseline`);
        }
        const anchors = await page.locator('[data-case-stage]').evaluateAll(nodes => nodes.map(n => {
          const height = innerWidth <= 900 ? n.offsetHeight : n.querySelector('.case-stage__content').offsetHeight;
          return scrollY + n.getBoundingClientRect().top - Math.max(24, (innerHeight - height) / 2);
        }));
        await jump(page, anchors[0]);
        await checkInput(page, width);
        const lastEnd = await page.locator('[data-case-stage]').last().evaluate((n, start) => {
          const height = innerWidth <= 900 ? n.offsetHeight : n.querySelector('.case-stage__content').offsetHeight;
          return Math.max(start, scrollY + n.getBoundingClientRect().top + height - innerHeight + 24);
        }, anchors.at(-1));
        await jump(page, lastEnd);
        assert.ok((await signatures(page)).progress > 0.999, 'last resting state reaches section end (subpixel scroll rounding)');
        await page.mouse.wheel(0, 700);
        await page.waitForTimeout(200);
        assert.ok(await page.evaluate(y => scrollY > y + 300, lastEnd), 'native scroll continues beyond the scene');
        await page.keyboard.press('Home');
        await page.waitForTimeout(600);
        assert.equal(await page.evaluate(() => scrollY), 0, 'Home remains native');
        await page.keyboard.press('End');
        await page.waitForTimeout(600);
        assert.equal(await page.evaluate(() => scrollY), await page.evaluate(() => document.documentElement.scrollHeight - innerHeight), 'End remains native');
        await jump(page, anchors[1]);
        const restored = await signatures(page);
        const restoredY = await page.evaluate(() => scrollY);
        await page.reload();
        await page.evaluate(() => document.fonts.ready);
        // The site's existing CSS smooth behavior also applies to browser history restoration.
        await page.waitForFunction(y => Math.abs(scrollY - y) < 2, restoredY);
        await page.waitForTimeout(80);
        const reloadedY = await page.evaluate(() => scrollY);
        assert.ok(Math.abs(reloadedY - restoredY) < 2, `${route}/${width}: reload restores native position (${reloadedY} vs ${restoredY})`);
        assert.deepEqual(await signatures(page), restored);
        const deepId = await page.locator('[data-case-stage]').nth(1).getAttribute('id');
        await page.goto(`${base}/projects/${route}/#${deepId}`);
        await page.waitForTimeout(600);
        assert.equal((await signatures(page)).active, deepId, 'deep link starts at the correct stage');
        await page.setViewportSize({ width: width > 900 ? 390 : 1440, height: 650 });
        await page.waitForTimeout(200);
        const resizedY = await page.evaluate(() => scrollY);
        const resized = await signatures(page);
        await jump(page, resizedY + 150);
        await jump(page, resizedY);
        assert.deepEqual(await signatures(page), resized, 'resize recomputes state from current geometry');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.waitForTimeout(80);
        assert.equal(await page.locator('[data-case-story]').evaluate(n => n.style.getPropertyValue('--case-active-translate-y')), '0px');
        assert.deepEqual(await page.evaluate(() => window.__appScrollWrites), []);
        console.log(`PASS ${route} ${width}px: native input, all stages, reverse, tall content, exit, reload, deep link, resize`);
      }
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: ${before ? 'before' : 'after'} scene states in ${dir}`);
} finally { await browser.close(); }
