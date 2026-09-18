// All API traffic is intercepted; no writes or model calls reach production.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { localStorage.setItem('accesscode', 'test'); localStorage.setItem('nickname', 'Tester'); });
    let labelMode = 'slow'; let release; let pending;
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()); let body; let status = 200;
      if (url.pathname === '/api/members') body = { members: [{ name: 'Tester', avatar: '' }] };
      else if (url.pathname === '/api/songs') body = { songs: [] };
      else if (url.pathname === '/api/schedule') body = { dates: [], startHour: 10, endHour: 22, availability: {}, confirmed: [] };
      else if (url.pathname === '/api/export-config') body = {};
      else if (url.pathname === '/api/music-search') body = { results: [{ id: url.searchParams.get('provider'), title: 'Test result', artist: 'Artist', url: 'https://example.com/music', duration: '3:00', artwork: '' }] };
      else if (url.pathname === '/api/music-labels') {
        if (labelMode === 'slow') { pending = true; await new Promise(r => { release = r; }); }
        if (labelMode === 'fail') { status = 503; body = { error: 'unavailable' }; }
        else body = { results: [{ id: url.searchParams.get('provider'), badges: labelMode === 'empty' ? [] : ['live', 'cover'] }] };
      } else throw new Error('Unexpected API ' + url.pathname);
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(process.env.UX_BASE_URL || 'http://127.0.0.1:3918');
    await page.locator('#btn-add-song').click();
    await page.locator('#music-query').fill('first');
    await page.locator('#music-search-form').evaluate(el => el.requestSubmit());
    await page.locator('[data-pick="0"]').waitFor();
    assert.equal(await page.locator('[data-pick="0"]').isEnabled(), true);
    while (!pending) await new Promise(r => setTimeout(r, 10));
    assert.match(await page.locator('#music-status').innerText(), /버전 확인 중/);
    // A stale response must not label a new, cleared search.
    await page.locator('#music-query').fill('second'); release();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.music-badge').count(), 0);
    labelMode = 'success';
    await page.locator('#music-search-form').evaluate(el => el.requestSubmit());
    await page.locator('.music-badge').first().waitFor();
    assert.deepEqual(await page.locator('.music-badge').allTextContents(), ['라이브', '커버']);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('[data-pick="0"]').click();
    assert.equal(await page.locator('#f-title').inputValue(), 'Test result');
    await page.locator('#change-song').click();
    labelMode = 'empty';
    await page.locator('#music-query').fill('empty');
    await page.locator('#music-search-form').evaluate(el => el.requestSubmit());
    await page.waitForFunction(() => document.querySelector('#music-status').textContent.includes('표시할 버전 정보가 없어요'));
    assert.equal(await page.locator('.music-badge').count(), 0);
    assert.equal(await page.locator('[data-pick="0"]').isEnabled(), true);
    labelMode = 'fail';
    await page.locator('#music-query').fill('failure');
    await page.locator('#music-search-form').evaluate(el => el.requestSubmit());
    await page.waitForFunction(() => document.querySelector('#music-status').textContent.includes('곡 선택은 가능'));
    assert.equal(await page.locator('[data-pick="0"]').isEnabled(), true);
    assert.equal(await page.locator('.music-badge').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: delayed labels do not block selection, stale responses ignored, dual badges, mobile layout, API failure retains search');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
