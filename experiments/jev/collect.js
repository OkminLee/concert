const fs = require('node:fs');
const path = require('node:path');
const { youtubeResults } = require('../../music-search');

async function main() {
  const output = path.join(__dirname, 'samples.json');
  if (fs.existsSync(output)) throw new Error('samples.json already exists; preserve the evaluation set.');
  const queries = ['한로로 입춘', 'Vaundy 怪獣の花唄', 'Oasis Don’t Look Back In Anger', '잔나비 주저하는 연인들을 위해', 'DAY6 한 페이지가 될 수 있게'];
  const samples = [];
  const seen = new Set();
  for (const query of queries) {
    const response = await fetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(query), {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ko' }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('YouTube HTTP ' + response.status);
    const results = youtubeResults(await response.text()).filter(r => !seen.has(r.id)).slice(0, 10);
    if (results.length !== 10) throw new Error('Expected 10 unique results for ' + query);
    for (const { id, title, artist, url } of results) {
      seen.add(id); samples.push({ id, title, artist, url, query });
    }
  }
  fs.writeFileSync(output, JSON.stringify({ collectedAt: new Date().toISOString(), samples }, null, 2) + '\n', { flag: 'wx' });
  console.log('Collected ' + samples.length + ' public search results.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
