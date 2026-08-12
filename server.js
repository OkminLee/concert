const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const SESSIONS = ['vocal', 'guitar', 'bass', 'drum', 'keyboard'];

// ---- 저장소: JSON 파일 (임시파일 → rename 으로 원자적 저장) ----
let db = { songs: [] };
if (fs.existsSync(DATA_FILE)) {
  db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

const app = express();
app.use(express.json());
// no-cache: 매 요청 ETag 재검증(변경 없으면 304) — 배포 직후 구버전 JS가 휴리스틱 캐시로 남는 것 방지
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }),
);

// ---- 입장 인증코드: 밴드 공용 코드 1개, 기기당 1회 입력 ----
const ACCESS_CODE = (process.env.ACCESS_CODE || 'yb2026').trim();

function codeMatches(input) {
  if (typeof input !== 'string') return false;
  const a = Buffer.from(input.trim());
  const b = Buffer.from(ACCESS_CODE);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 무차별 대입 방지: IP당 분당 10회 (터널 뒤에서는 CF-Connecting-IP가 실제 클라이언트)
const authAttempts = new Map();
app.post('/api/auth', (req, res) => {
  const ip = req.get('cf-connecting-ip') || req.ip;
  const now = Date.now();
  // 만료 레코드 정리 — IP 로테이션으로 맵이 무한히 자라지 않게
  if (authAttempts.size > 1000)
    for (const [k, r] of authAttempts) if (now > r.resetAt) authAttempts.delete(k);
  const rec = authAttempts.get(ip) || { count: 0, resetAt: now + 60_000 };
  if (now > rec.resetAt) {
    rec.count = 0;
    rec.resetAt = now + 60_000;
  }
  rec.count += 1;
  authAttempts.set(ip, rec);
  if (rec.count > 10)
    return res.status(429).json({ error: '시도가 너무 많아요. 1분 뒤 다시 해주세요' });
  if (!codeMatches(req.body?.code))
    return res.status(401).json({ error: '인증코드가 맞지 않아요' });
  authAttempts.delete(ip);
  res.json({ ok: true });
});

// /api/auth 를 제외한 모든 API는 코드 헤더 필수 (클라이언트는 URI 인코딩해 전송)
app.use('/api', (req, res, next) => {
  if (req.path === '/auth') return next();
  let header = req.get('x-access-code') || '';
  try {
    header = decodeURIComponent(header);
  } catch {
    // 인코딩 깨진 헤더는 그대로 비교 → 아래에서 401
  }
  if (codeMatches(header)) return next();
  res.status(401).json({ error: '인증이 필요해요' });
});

// 곡 링크는 http(s)만 저장 — javascript: 등 스킴 차단
function cleanLink(link) {
  const l = typeof link === 'string' ? link.trim() : '';
  return /^https?:\/\//i.test(l) ? l : '';
}

function findSong(req, res) {
  const song = db.songs.find((s) => s.id === req.params.id);
  if (!song) res.status(404).json({ error: '곡을 찾을 수 없어요' });
  return song;
}

function cleanSlots(input) {
  const slots = {};
  for (const s of SESSIONS) {
    const n = Number(input?.[s]);
    slots[s] = Number.isInteger(n) && n >= 0 ? n : 0;
  }
  return slots;
}

// ---- 곡 목록 ----
app.get('/api/songs', (req, res) => {
  res.json({ sessions: SESSIONS, songs: db.songs });
});

// ---- 곡 추가 ----
app.post('/api/songs', (req, res) => {
  const { title, artist, link, slots, nickname } = req.body || {};
  if (!nickname?.trim()) return res.status(400).json({ error: '닉네임이 필요해요' });
  if (!title?.trim()) return res.status(400).json({ error: '곡 이름이 필요해요' });
  const song = {
    id: crypto.randomUUID(),
    title: title.trim(),
    artist: (artist || '').trim(),
    link: cleanLink(link),
    slots: cleanSlots(slots),
    members: Object.fromEntries(SESSIONS.map((s) => [s, []])),
    comments: [],
    createdBy: nickname.trim(),
    createdAt: new Date().toISOString(),
  };
  db.songs.unshift(song);
  save();
  res.status(201).json(song);
});

// ---- 곡 수정 (곡명·뮤지션·링크·세션 정원) ----
app.patch('/api/songs/:id', (req, res) => {
  const song = findSong(req, res);
  if (!song) return;
  const { title, artist, link, slots } = req.body || {};
  if (title !== undefined) {
    if (!title.trim()) return res.status(400).json({ error: '곡 이름은 비울 수 없어요' });
    song.title = title.trim();
  }
  if (artist !== undefined) song.artist = artist.trim();
  if (link !== undefined) song.link = cleanLink(link);
  if (slots !== undefined) song.slots = cleanSlots(slots);
  save();
  res.json(song);
});

// ---- 곡 삭제 ----
app.delete('/api/songs/:id', (req, res) => {
  const song = findSong(req, res);
  if (!song) return;
  db.songs = db.songs.filter((s) => s.id !== song.id);
  save();
  res.json({ ok: true });
});

// ---- 세션 참가 / 빠지기 ----
app.post('/api/songs/:id/members', (req, res) => {
  const song = findSong(req, res);
  if (!song) return;
  const { session, name } = req.body || {};
  if (!SESSIONS.includes(session)) return res.status(400).json({ error: '없는 세션이에요' });
  if (!name?.trim()) return res.status(400).json({ error: '이름이 필요해요' });
  const trimmed = name.trim();
  if (song.members[session].includes(trimmed))
    return res.status(409).json({ error: '이미 신청되어 있어요' });
  song.members[session].push(trimmed);
  save();
  res.json(song);
});

app.delete('/api/songs/:id/members', (req, res) => {
  const song = findSong(req, res);
  if (!song) return;
  const { session, name } = req.body || {};
  if (!SESSIONS.includes(session)) return res.status(400).json({ error: '없는 세션이에요' });
  song.members[session] = song.members[session].filter((n) => n !== name);
  save();
  res.json(song);
});

// ---- 코멘트 (시트의 I열 이후 자유 발언) ----
app.post('/api/songs/:id/comments', (req, res) => {
  const song = findSong(req, res);
  if (!song) return;
  const { author, text } = req.body || {};
  if (!author?.trim() || !text?.trim())
    return res.status(400).json({ error: '닉네임과 내용이 필요해요' });
  song.comments.push({
    id: crypto.randomUUID(),
    author: author.trim(),
    text: text.trim(),
    at: new Date().toISOString(),
  });
  save();
  res.json(song);
});

app.delete('/api/songs/:id/comments/:cid', (req, res) => {
  const song = findSong(req, res);
  if (!song) return;
  song.comments = song.comments.filter((c) => c.id !== req.params.cid);
  save();
  res.json(song);
});

// ---- 코멘트 리액션 토글 ----
app.post('/api/songs/:id/comments/:cid/react', (req, res) => {
  const song = findSong(req, res);
  if (!song) return;
  const comment = song.comments.find((c) => c.id === req.params.cid);
  if (!comment) return res.status(404).json({ error: '코멘트를 찾을 수 없어요' });
  const { emoji, name } = req.body || {};
  if (typeof emoji !== 'string' || !emoji || emoji.length > 8)
    return res.status(400).json({ error: '이모지가 필요해요' });
  if (!name?.trim()) return res.status(400).json({ error: '닉네임이 필요해요' });
  comment.reactions = comment.reactions || {};
  const list = comment.reactions[emoji] || [];
  const i = list.indexOf(name.trim());
  if (i >= 0) list.splice(i, 1);
  else list.push(name.trim());
  if (list.length) comment.reactions[emoji] = list;
  else delete comment.reactions[emoji];
  save();
  res.json(song);
});

// ---- 멤버 프로필 (Slack #yb 매핑, members.json은 공개 repo 미포함) ----
app.get('/api/members', (req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(path.join(__dirname, 'members.json'), 'utf8')));
  } catch {
    res.json({ members: [] });
  }
});

// ---- 개선 제안 → GitHub 이슈 ----
let feedbackRepo = process.env.FEEDBACK_REPO || '';
if (!feedbackRepo) {
  execFile('git', ['config', '--get', 'remote.origin.url'], { cwd: __dirname }, (e, out) => {
    const m = (out || '').trim().match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (m) feedbackRepo = m[1];
  });
}
app.post('/api/feedback', (req, res) => {
  const { title, detail, nickname } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: '제목이 필요해요' });
  if (!feedbackRepo)
    return res.status(503).json({ error: '저장소가 아직 연결되지 않았어요' });
  const body = `${(detail || '').trim()}\n\n---\n제안: ${(nickname || '익명').trim()} · 합주 세트리스트 웹에서 자동 생성`;
  execFile(
    'gh',
    ['issue', 'create', '-R', feedbackRepo, '--title', title.trim(), '--body', body],
    (err, out) => {
      if (err) return res.status(502).json({ error: '이슈 생성에 실패했어요' });
      res.json({ url: out.trim() });
    },
  );
});

// ---- 링크 자동 분해: oEmbed 로 제목·뮤지션 추출 ----
function oembedEndpoint(url) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  const u = encodeURIComponent(url);
  if (host === 'youtu.be' || host.endsWith('youtube.com'))
    return `https://www.youtube.com/oembed?url=${u}&format=json`;
  if (host.endsWith('spotify.com')) return `https://open.spotify.com/oembed?url=${u}`;
  if (host.endsWith('soundcloud.com'))
    return `https://soundcloud.com/oembed?url=${u}&format=json`;
  return null;
}

function splitArtistTitle(rawTitle, author) {
  // "(Official MV)" "[가사]" 류 꼬리표 제거
  let t = rawTitle
    .replace(/[\[(][^\])]*(?:official|video|audio|m\/v|mv|lyric|live|가사|뮤직비디오|공식|라이브)[^\])]*[\])]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // 유튜브 자동생성 채널("아티스트 - Topic")은 가장 신뢰 가능
  if (author && / - Topic$/.test(author))
    return { artist: author.replace(/ - Topic$/, ''), title: t };
  for (const sep of [' - ', ' – ', ' — ', ' | ']) {
    const i = t.indexOf(sep);
    if (i > 0)
      return { artist: t.slice(0, i).trim(), title: t.slice(i + sep.length).trim() };
  }
  const quoted = t.match(/^(.+?)\s*['‘’"“”](.+?)['‘’"“”]/);
  if (quoted) return { artist: quoted[1].trim(), title: quoted[2].trim() };
  return { artist: author || '', title: t };
}

app.post('/api/parse-link', async (req, res) => {
  const { url } = req.body || {};
  const endpoint = url && oembedEndpoint(url);
  if (!endpoint)
    return res.status(400).json({ error: 'YouTube·Spotify·SoundCloud 링크만 자동 인식돼요' });
  try {
    const r = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`oembed ${r.status}`);
    const meta = await r.json();
    res.json(splitArtistTitle(meta.title || '', meta.author_name || ''));
  } catch {
    res.status(502).json({ error: '링크 정보를 가져오지 못했어요. 수동으로 입력해주세요' });
  }
});

// ---- 유튜브 검색 보충: 링크 없는 곡을 "뮤지션 제목"으로 검색해 첫 결과 사용 ----
// 공식 Data API는 키가 필요해 결과 페이지를 파싱한다 — 마크업 변경 시 이 정규식만 손보면 됨
const ytSearchCache = new Map(); // q -> videoId
app.post('/api/search-youtube', async (req, res) => {
  const q = typeof req.body?.q === 'string' ? req.body.q.trim() : '';
  if (!q) return res.status(400).json({ error: '검색어가 필요해요' });
  if (ytSearchCache.has(q)) return res.json({ videoId: ytSearchCache.get(q) });
  try {
    // 여러 곡 연속 검색 시 간헐 실패가 잦아 1회 재시도
    let html;
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(
          `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
          {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
              'Accept-Language': 'ko',
            },
            signal: AbortSignal.timeout(6000),
          },
        );
        if (!r.ok) throw new Error(`yt ${r.status}`);
        html = await r.text();
        break;
      } catch (e) {
        if (attempt >= 1) throw e;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    const m = html.match(/"videoRenderer":\{"videoId":"([\w-]{6,})"/);
    if (!m) return res.status(404).json({ error: '검색 결과가 없어요' });
    if (ytSearchCache.size > 500) ytSearchCache.clear();
    ytSearchCache.set(q, m[1]);
    res.json({ videoId: m[1] });
  } catch {
    res.status(502).json({ error: '유튜브 검색에 실패했어요' });
  }
});

// ---- Apple Music developer token (MusicKit) ----
// env 3개가 모두 있어야 발급 — 없으면 null이 내려가고 클라이언트는 목록 복사로 동작
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || '';
const APPLE_KEY_ID = process.env.APPLE_KEY_ID || '';
const APPLE_KEY_PATH = process.env.APPLE_MUSIC_KEY_PATH || '';
let appleToken = { value: null, exp: 0 };
function appleDeveloperToken() {
  if (!APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_KEY_PATH) return null;
  const now = Math.floor(Date.now() / 1000);
  if (appleToken.value && now < appleToken.exp - 3600) return appleToken.value;
  try {
    const key = fs.readFileSync(APPLE_KEY_PATH, 'utf8');
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const exp = now + 60 * 60 * 24 * 30;
    const data = `${b64({ alg: 'ES256', kid: APPLE_KEY_ID, typ: 'JWT' })}.${b64({ iss: APPLE_TEAM_ID, iat: now, exp })}`;
    const sig = crypto
      .sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' })
      .toString('base64url');
    appleToken = { value: `${data}.${sig}`, exp };
    return appleToken.value;
  } catch {
    return null; // 키 파일 오류 — 미설정과 동일하게 동작
  }
}
app.get('/api/export-config', (req, res) => {
  res.json({ appleDeveloperToken: appleDeveloperToken() });
});

app.listen(PORT, () => {
  console.log(`🎸 concert running on http://localhost:${PORT}`);
});
