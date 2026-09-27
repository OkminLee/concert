const {test}=require('node:test'),assert=require('node:assert/strict');
const {links,render}=require('./public/comment-links.js');
test('comment URLs retain query parameters, escape markup, trim punctuation and deduplicate previews',()=>{
 const url='https://www.youtube.com/watch?v=6vSXA52L_cw&list=RD6vSXA52L_cw&start_radio=1';
 const html=render('<img src=x onerror=alert(1)> '+url+'\n('+url+'). javascript:alert(1)');
 assert.equal(links('('+url+').')[0].url,url);
 assert.equal((html.match(/data-preview-url=/g)||[]).length,1);
 assert(!html.includes('<img'));assert(html.includes('&amp;list='));assert(html.includes('rel="noopener noreferrer"'));
 assert.equal(links('https://user:password@example.com').length,0);
});
