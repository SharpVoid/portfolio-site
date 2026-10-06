import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'msedge' }) });
const base = process.env.SITE_URL || 'http://localhost:4321';
const errors = [], audit = [];
await mkdir('.artifacts', { recursive: true });
try {
  for (const width of [1920, 1440, 1024, 800, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2, hasTouch: width === 390 });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    for (const route of ['/', '/projects/doverie/', '/projects/focusml/', '/projects/design-arena/']) {
      assert.equal((await page.goto(base + route)).status(), 200);
      await page.evaluate(async () => {
        await document.fonts.ready;
        document.documentElement.style.scrollBehavior = 'auto';
        await Promise.all([...document.images].filter(image => image.getAttribute('src')).map(image => { image.loading = 'eager'; return image.decode(); }));
      });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${route} ${width}: overflow`);
      if (route === '/') {
        assert.deepEqual(await page.locator('.project-card').evaluateAll(cards => cards.map(card => card.id)), ['doverie', 'focusml', 'design-arena', 'atomreport']);
        assert.equal(await page.locator('#doverie p').innerText(), 'Мобильный банк с общим счётом и системой локальных переводов «Рядом»');
        assert.match(await page.locator('#design-arena p:visible').innerText(), /24 часа/);
        assert.match(await page.locator('#atomreport .project-card__content').innerText(), /продуктовый дизайнер и исследователь.*AI-чат.*систему тегов/s);
        assert.match(await page.locator('#atomreport .project-card__content').innerText(), /Посмотреть продукт ↗/);
        assert.equal(await page.locator('#atomreport a').getAttribute('href'), 'https://www.consulai.ru/');
        assert.equal(await page.locator('#doverie img').getAttribute('fetchpriority'), 'high');
        for (const id of ['doverie', 'focusml', 'design-arena']) {
          const link = page.locator(`#${id} .project-card__link`);
          assert.equal(await link.getAttribute('href'), `/projects/${id}/`);
          await link.scrollIntoViewIfNeeded();
          const video = page.locator(`#${id} video`);
          await page.waitForFunction(id => {
            const video = document.querySelector(`#${id} video`);
            return video.classList.contains('is-playing') && !video.paused && video.currentTime > 0;
          }, id);
          await page.locator(`#${id} .project-card__playback`).click({ force: true });
          assert.equal(await video.evaluate(video => video.paused), true);
          await page.locator(`#${id} .project-card__playback`).click({ force: true });
          await page.waitForFunction(id => !document.querySelector(`#${id} video`).paused, id);
          await link.click();
          await page.waitForURL(base + `/projects/${id}/`);
          assert.equal(await page.locator('.case-hero h1').count(), 1);
          await page.goto(base + '/');
        }
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.evaluate(() => Promise.all([...document.images].map(image => { image.loading = 'eager'; return image.decode(); })));
        await page.screenshot({ path: `.artifacts/review-home-${width}.png`, fullPage: true });
      } else {
        const hero = await page.locator('.case-hero img').evaluate(image => {
          const rect = image.getBoundingClientRect();
          return { src: image.currentSrc, width: rect.width, height: rect.height, maximum: Math.max(...image.srcset.split(',').map(source => Number(source.trim().match(/ (\d+)w$/)?.[1] || 0))) };
        });
        const pixels = await sharp(await (await page.request.get(hero.src)).body()).metadata();
        const required = Math.max(hero.width, hero.height * pixels.width / pixels.height) * 2;
        assert.ok(pixels.width >= Math.min(required, hero.maximum) - 2, `${route} ${width}: hero uses available Retina pixels`);
        if (route.includes('doverie')) assert.match(await page.locator('.case-hero__copy p').innerText(), /общий счёт.*совместных расходов/);
        if (route.includes('design-arena')) {
          assert.match(await page.locator('.case-hero__copy p').innerText(), /24 часа/);
          assert.equal(await page.getByText('24 часа', { exact: true }).isVisible(), true);
        }
        if (route.includes('focusml')) assert.match(await page.locator('.case-hero__copy p').innerText(), /NDA/);
        const images = await page.locator('.case-hero img, [data-image-preview]').evaluateAll(images => images.filter(image => image.getBoundingClientRect().width).map(image => {
          const rect = image.getBoundingClientRect(), css = getComputedStyle(image);
          return { src: image.currentSrc, original: image.dataset.imagePreview, alt: image.alt, natural: [image.naturalWidth, image.naturalHeight], displayed: [rect.width, rect.height], objectFit: css.objectFit, transform: css.transform };
        }));
        assert.ok(images.every(image => image.natural[0] > 0));
        audit.push({ width, route, dpr: 2, images });
        await page.screenshot({ path: `.artifacts/review-${route.split('/')[2]}-${width}.png` });
      }
    }
    await page.close();
    console.log(`PASS portfolio review ${width}px: copy, order, case links, playing/pause/resume, images, overflow`);
  }
  assert.deepEqual(errors, []);
  await writeFile('.artifacts/review-images-after.json', JSON.stringify(audit, null, 2));
} finally { await browser.close(); }
