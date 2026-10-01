// Capture before a template change, then compare geometry and masked screenshots.
// CASE_SNAPSHOT_DIR keeps baselines outside the repository.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const capture = process.argv.includes('--capture');
const dir = process.env.CASE_SNAPSHOT_DIR || join(tmpdir(), 'portfolio-case-template');
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [];
try {
  for (const width of [1440, 1920, 800, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.SCROLL_URL || 'http://localhost:4322/projects/doverie/');
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].filter(i => i.src).map(i => { i.loading = 'eager'; return i.decode().catch(() => {}); }));
      document.documentElement.style.scrollBehavior = 'auto';
    });
    for (const position of ['hero', 'about', 'problem', 'solution', 'shared-account', 'nearby']) {
      if (position === 'about') {
        await page.evaluate(() => scrollTo(0, scrollY + document.querySelector('[data-case-story]').getBoundingClientRect().top - 300));
      } else if (position !== 'hero') {
        await page.locator(`[data-case-stage="${position}"]`).evaluate(el => {
          const height = innerWidth > 900 ? el.querySelector('.case-stage__content').offsetHeight : el.offsetHeight;
          scrollTo(0, scrollY + el.getBoundingClientRect().top - Math.max(24, (innerHeight - height) / 2));
        });
      }
      await page.waitForTimeout(1300);
      const geometry = await page.locator('.case-page').evaluate(root => [...root.querySelectorAll('*')].map(el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return { tag: el.tagName, class: el.getAttribute('class'), rect: [rect.x, rect.y, rect.width, rect.height].map(n => Math.round(n * 100) / 100),
          style: ['fontSize', 'lineHeight', 'color', 'backgroundColor', 'borderRadius', 'borderWidth', 'outlineWidth', 'opacity', 'display'].map(k => style[k]) };
      }));
      const key = join(dir, `${width}-${position}`);
      const shot = await page.screenshot({ animations: 'disabled', mask: [page.locator('video'), page.locator('[data-moscow-clock]')] });
      if (capture) {
        await writeFile(`${key}.json`, JSON.stringify(geometry));
        await writeFile(`${key}.png`, shot);
      } else {
        const baseline = JSON.parse(await readFile(`${key}.json`, 'utf8'));
        // The live clock changes glyph widths (and its centered parent's x).
        const clockStart = geometry.findIndex(el => el.class === 'site-footer');
        for (let i = clockStart; i < clockStart + 4; i++) {
          geometry[i].rect = baseline[i].rect;
        }
        const difference = geometry.findIndex((el, i) => JSON.stringify(el) !== JSON.stringify(baseline[i]));
        assert.equal(difference, -1, `${width}/${position}: element ${difference}: ${JSON.stringify(geometry[difference])} != ${JSON.stringify(baseline[difference])}`);
        assert.ok(shot.equals(await readFile(`${key}.png`)), `${width}/${position}: screenshot changed`);
      }
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: ${capture ? 'captured' : 'identical'} 24 desktop/tablet/mobile states in ${dir}`);
} finally { await browser.close(); }
