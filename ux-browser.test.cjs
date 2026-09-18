// Read-only page load; every API request is intercepted with synthetic fixtures.
// NODE_PATH=<directory containing playwright> node ux-browser.test.cjs
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.UX_BASE_URL || 'http://localhost:3917';
const roles = ['vocal','guitar','bass','drum','keyboard'];
function fixture(id, filled) {
  return {id, title:'테스트 곡 '+id, artist:'Test Artist', link:'', createdBy:'Livio', createdAt:'2026-09-16T00:00:00Z',
    slots:Object.fromEntries(roles.map(r=>[r,1])), members:Object.fromEntries(roles.map((r,i)=>[r,i<filled?['Livio']:[]])), comments:[]};
}
(async () => {
  for (const engine of ['chromium','webkit']) {
    const browser = await ({chromium,webkit}[engine]).launch(engine === 'webkit' && process.env.WEBKIT_EXECUTABLE ? {executablePath:process.env.WEBKIT_EXECUTABLE} : {});
    try {
      const context = await browser.newContext({viewport:{width:1440,height:1000}});
      let songs = [fixture('a',0),fixture('b',2),fixture('c',4),fixture('d',5),fixture('e',2),fixture('f',2),fixture('g',2)];
      let commentFail = false, saveFail = false, searchFail = false, saveCount = 0, commentCount = 0;
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('dialog',d=>d.accept());
      await page.addInitScript(()=>{localStorage.setItem('accesscode','ux-test');localStorage.setItem('nickname','Livio');});
      await page.route('**/api/**', async route => {
        const req = route.request(), url = new URL(req.url()), path = url.pathname;
        let body, status = 200;
        if(path === '/api/members') body={members:[{name:'Livio',slack:'Livio',avatar:''},{name:'Other',slack:'Other',avatar:''}]};
        else if(path === '/api/schedule') body={dates:[],startHour:10,endHour:22,availability:{},confirmed:[]};
        else if(path === '/api/songs' && req.method()==='GET') body={songs};
        else if(path === '/api/music-search') {
          if(searchFail) {status=503;body={error:'검색 연결 실패'};}
          else {const provider=url.searchParams.get('provider');body={results:[{id:provider,title:'검색곡 '+provider,artist:'Channel / Artist',url:'https://example.com/'+provider,artwork:'',duration:'3:00'}]};}
        }
        else if(path === '/api/music-labels') body={results:[]};
        else if(path === '/api/songs' && req.method()==='POST') {
          saveCount++; await new Promise(r=>setTimeout(r,180));
          if(saveFail) {status=503;body={error:'저장 실패: 다시 시도'};}
          else {const v=req.postDataJSON();body={...fixture('new'+saveCount,0),...v,createdBy:v.nickname};songs.push(body);}
        }
        else if(path.endsWith('/comments') && req.method()==='POST') {
          commentCount++; await new Promise(r=>setTimeout(r,150));
          if(commentFail) {status=503;body={error:'댓글 저장 실패'};}
          else {const s=songs.find(s=>s.id===path.split('/')[3]);s.comments.push({...req.postDataJSON(),id:'comment'+commentCount});body=s;}
        }
        else if(path === '/api/export-config') body={};
        else {throw new Error('Unexpected API request '+req.method()+' '+path);}
        await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      });
      await page.goto(base);
      await page.locator('#songs .song').first().waitFor();
      const row=page.locator('.song[data-id="b"] .row-head');
      await row.click();
      assert.equal(await page.locator('#song-dialog-title').evaluate(el=>el===document.activeElement),true);
      for(let i=0;i<30;i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(()=>document.querySelector('#song-dialog').contains(document.activeElement)),true,'focus escaped dialog'); }
      const input=page.locator('#song-dialog .comment-form input');
      await input.fill('초안 유지');
      songs.find(s=>s.id==='b').comments.push({id:'remote',author:'Other',text:'갱신된 댓글'});
      await page.evaluate(()=>poll());
      assert.equal(await input.inputValue(),'초안 유지','poll must retain draft');
      const panel=await page.locator('.song-dialog-panel').boundingBox();
      await page.mouse.move(panel.x+10,panel.y+10);await page.mouse.down();await page.mouse.move(2,2);await page.mouse.up();
      assert.equal(await page.locator('#song-dialog').evaluate(el=>el.open),true,'inside drag must not dismiss');
      await page.locator('#song-dialog-close').click();
      await row.click();assert.equal(await input.inputValue(),'초안 유지');
      await page.keyboard.press('Escape'); await row.click();assert.equal(await input.inputValue(),'초안 유지');
      await page.mouse.click(2,2);assert.equal(await page.locator('#song-dialog').evaluate(el=>el.open),false);
      await row.click();
      await input.fill('실패해도 남음'); commentFail=true;
      await page.locator('#song-dialog .comment-form button').click();
      await page.waitForFunction(()=>!document.querySelector('#song-dialog .comment-form button').disabled);
      assert.equal(await input.inputValue(),'실패해도 남음');
      commentFail=false;
      await page.locator('#song-dialog .comment-form button').click();
      await page.waitForFunction(()=>document.querySelector('#song-dialog .comment-form input').value==='');
      await input.fill('Livio 전용');
      await page.keyboard.press('Escape');
      await page.locator('.site-menu summary').click();await page.locator('#btn-me').click();
      await page.locator('.profile[data-name="Livio"]').click();await row.click();assert.equal(await input.inputValue(),'Livio 전용');
      await page.keyboard.press('Escape');
      await page.locator('.site-menu summary').click(); await page.locator('#btn-me').click();
      await page.locator('.profile[data-name="Other"]').click();await row.click();assert.equal(await input.inputValue(),'');
      await page.keyboard.press('Escape');
      await page.locator('#state-filter').selectOption('full');assert.equal(await page.locator('#songs .song').count(),1);
      await page.locator('#state-filter').selectOption('near');assert.equal(await page.locator('#songs .song').count(),1);
      assert.equal(await page.locator('#songs .song').first().getAttribute('data-id'),'c');
      await page.locator('#role-filter').selectOption('vocal');assert.equal(await page.locator('#songs .song').count(),0);
      await page.locator('[data-clear="role"]').click();assert.equal(await page.locator('#songs .song').count(),1);
      await page.locator('[data-clear="state"]').click();
      await page.locator('#search').fill('테스트 곡 b');
      assert.equal(await page.locator('#songs .song').count(),1);
      await page.locator('.view-options summary').click();await page.locator('#btn-export').click();
      assert.equal(await page.locator('#x-songs input').count(),1);await page.locator('#x-close').click();
      await page.locator('#search').fill('');
      await page.locator('#state-filter').selectOption('full');
      for(const provider of ['youtube','apple','spotify']) {
        await page.locator('#btn-add-song').click();
        await page.locator('[data-provider="'+provider+'"]').click();
        await page.locator('#music-query').fill('query');
        await page.locator('#music-search-form').evaluate(el=>el.requestSubmit());
        await page.locator('[data-pick="0"]').click();
        assert.equal(await page.locator('#music-search-pane').isVisible(),false);
        assert.equal(await page.locator('#f-title').inputValue(),'검색곡 '+provider);
        assert.equal(await page.locator('#f-artist').inputValue(),provider==='youtube'?'':'Channel / Artist');
        if(provider!=='spotify') await page.locator('#change-song').click();
      }
      saveFail=true;await page.locator('#song-form').evaluate(el=>{el.requestSubmit();el.requestSubmit();});
      await page.waitForFunction(()=>!document.querySelector('#song-form button[type="submit"]').disabled);
      assert.equal(saveCount,1);assert.equal(await page.locator('#f-title').inputValue(),'검색곡 spotify');
      assert.match(await page.locator('#song-save-status').innerText(),/저장 실패/);
      saveFail=false;await page.locator('#song-form').evaluate(el=>el.requestSubmit());
      await page.waitForFunction(()=>document.querySelector('#workspace-status').textContent.includes('추가했어요'));
      assert.equal(saveCount,2);
      assert.equal(await page.locator('#state-filter').inputValue(),'full');
      assert.match(await page.locator('#workspace-status').innerText(),/현재 필터에서 보이지/);
      await page.locator('#show-added-song').click();assert.equal(await page.locator('#state-filter').inputValue(),'all');
      await page.locator('#btn-add-song').click();searchFail=true;
      await page.locator('#music-query').fill('fail');await page.locator('#music-search-form').evaluate(el=>el.requestSubmit());
      await page.waitForFunction(()=>document.querySelector('#music-status').textContent.includes('검색 연결 실패'));
      await page.locator('#composer-toggle').click();
      await page.locator('.site-menu').evaluate(el=>el.open=false);
      await page.locator('.view-options').evaluate(el=>el.open=false);
      for(const width of [320,390,768,1440]) {
        await page.setViewportSize({width,height:844});await page.evaluate(()=>window.scrollTo(0,0));
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page overflow at '+width);
      }
      await page.setViewportSize({width:390,height:844});await page.locator('#songs .row-head').first().click();
      await page.mouse.click(2,2);assert.equal(await page.locator('#song-dialog').evaluate(el=>el.open),false,'mobile backdrop');
      assert.deepEqual(errors,[]);console.log(engine+': PASS drafts, failure/retry, identity, filters, export, three providers, double-submit, responsive widths');
      await context.close();
    } finally {await browser.close();}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
