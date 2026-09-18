const fs = require('fs');
const path = require('path');
const os = require('os');

class SearchError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
async function request(url, options = {}) {
  const r = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
  if (!r.ok) {
    if (r.status === 429) throw new SearchError(429, '검색 요청 한도를 넘었어요. 잠시 후 다시 검색해주세요.');
    if (r.status === 401 || r.status === 403) throw new SearchError(502, '음악 서비스 검색 인증을 확인해야 해요.');
    throw new SearchError(502, '음악 서비스가 응답하지 않아요. 잠시 후 다시 검색해주세요.');
  }
  return r;
}
function youtubeResults(html) {
  const match = html.match(/var ytInitialData = (.*?);<\/script>/s);
  if (!match) throw new SearchError(502, 'YouTube 검색 결과를 읽지 못했어요. 링크로 추가할 수 있어요.');
  const data = JSON.parse(match[1]);
  const found = new Map();
  const text = x => x?.simpleText || x?.runs?.map(r => r.text).join('') || '';
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    const v = node.videoRenderer;
    if (v?.videoId && !found.has(v.videoId)) found.set(v.videoId, {
      provider: 'youtube', id: v.videoId, title: text(v.title), artist: text(v.ownerText || v.longBylineText),
      url: 'https://www.youtube.com/watch?v=' + v.videoId,
      artwork: 'https://i.ytimg.com/vi/' + v.videoId + '/mqdefault.jpg', duration: text(v.lengthText),
    });
    for (const child of Object.values(node)) if (typeof child === 'object') walk(child);
  }
  walk(data);
  return [...found.values()].slice(0, 12);
}
function credentials() {
  if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET)
    return { client_id: process.env.SPOTIFY_CLIENT_ID, client_secret: process.env.SPOTIFY_CLIENT_SECRET };
  const file = path.join(os.homedir(), '.concert', 'spotify.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
let spotifyToken = { value: '', exp: 0 };
async function spotifyAuth() {
  if (spotifyToken.exp > Date.now() + 30000) return spotifyToken.value;
  const c = credentials();
  if (!c?.client_id || !c?.client_secret) throw new SearchError(503, 'Spotify 검색 연결 설정이 필요해요.');
  const r = await request('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(c.client_id + ':' + c.client_secret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const t = await r.json();
  spotifyToken = { value: t.access_token, exp: Date.now() + t.expires_in * 1000 };
  return spotifyToken.value;
}
const duration = ms => ms ? Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0') : '';
function install(app, appleToken, labeler = require('./music-labels').createLabeler()) {
  const cache = new Map();
  const requests = new Map();
  // Only classify metadata obtained by our authenticated search endpoint.
  app.get('/api/music-labels', async (req, res) => {
    const provider = req.query.provider;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!['youtube', 'apple', 'spotify'].includes(provider) || !q || q.length > 150)
      return res.status(400).json({ error: '서비스와 검색어를 확인해주세요.' });
    const cached = cache.get(provider + ':' + q.toLowerCase());
    if (!cached || cached.exp <= Date.now()) return res.status(410).json({ error: '검색 결과가 만료됐어요.' });
    res.set('Cache-Control', 'no-store');
    try { res.json({ results: await labeler.classify(cached.results) }); }
    catch { res.status(503).json({ error: '버전 표시를 사용할 수 없어요.' }); }
  });
  app.get('/api/music-search', async (req, res) => {
    const provider = req.query.provider;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!['youtube', 'apple', 'spotify'].includes(provider) || !q || q.length > 150)
      return res.status(400).json({ error: '서비스와 검색어(150자 이하)를 확인해주세요.' });
    const key = provider + ':' + q.toLowerCase();
    const cached = cache.get(key);
    if (cached && cached.exp > Date.now()) return res.json({ results: cached.results });
    const ip = req.get('cf-connecting-ip') || req.ip;
    const now = Date.now();
    for (const [k, value] of requests) if (now - value.since > 60000) requests.delete(k);
    const bucket = requests.get(ip) || { since: now, count: 0 };
    requests.set(ip, bucket);
    if (++bucket.count > 30) return res.status(429).json({ error: '검색이 너무 잦아요. 1분 후 다시 검색해주세요.' });
    try {
      let results;
      if (provider === 'youtube') {
        const r = await request('https://www.youtube.com/results?search_query=' + encodeURIComponent(q), { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ko' } });
        results = youtubeResults(await r.text());
      } else if (provider === 'apple') {
        const token = appleToken();
        if (!token) throw new SearchError(503, 'Apple Music 검색 연결 설정이 필요해요.');
        const r = await request('https://api.music.apple.com/v1/catalog/kr/search?' + new URLSearchParams({ term: q, types: 'songs', limit: '12' }), { headers: { Authorization: 'Bearer ' + token } });
        const data = await r.json();
        results = (data.results?.songs?.data || []).map(t => ({ provider, id: t.id, title: t.attributes.name, artist: t.attributes.artistName, url: t.attributes.url, artwork: t.attributes.artwork?.url.replace('{w}', '160').replace('{h}', '160') || '', duration: duration(t.attributes.durationInMillis) }));
      } else {
        const token = await spotifyAuth();
        const r = await request('https://api.spotify.com/v1/search?' + new URLSearchParams({ q, type: 'track', market: 'KR', limit: '10' }), { headers: { Authorization: 'Bearer ' + token } });
        const data = await r.json();
        results = (data.tracks?.items || []).filter(Boolean).map(t => ({ provider, id: t.id, title: t.name, artist: t.artists.map(a => a.name).join(', '), url: t.external_urls.spotify, artwork: t.album.images?.[0]?.url || '', duration: duration(t.duration_ms) }));
      }
      if (cache.size >= 150) cache.delete(cache.keys().next().value);
      cache.set(key, { results, exp: Date.now() + 300000 });
      res.json({ results });
    } catch (err) {
      res.status(err.status || 502).json({ error: err.status ? err.message : '검색에 실패했어요. 잠시 후 다시 시도해주세요.' });
    }
  });
}
module.exports = { install, youtubeResults };
