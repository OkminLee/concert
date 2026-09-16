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
// 구버전 data.json엔 schedule이 없다 — 메모리에서 채우고 다음 save()에 파일 반영
if (!db.schedule)
  db.schedule = { dates: [], startHour: 18, endHour: 23, availability: {}, confirmed: [] };
// 슬롯은 15분 단위 "YYYY-MM-DDTHH:MM". 초기 버전의 시간 단위 슬롯("…THH")은 4칸으로 확장
const QUARTER_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:(00|15|30|45)$/;
const HOUR_SLOT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}$/;
const quarterize = (s) =>
  typeof s !== 'string' ? []
  : QUARTER_RE.test(s) ? [s]
  : HOUR_SLOT_RE.test(s) ? ['00', '15', '30', '45'].map((m) => `${s}:${m}`)
  : [];
for (const [name, slots] of Object.entries(db.schedule.availability)) {
  if (slots.some((s) => HOUR_SLOT_RE.test(s)))
    db.schedule.availability[name] = [...new Set(slots.flatMap(quarterize))].sort();
}
// 확정된 날짜는 후보가 아니다 — 확정 라우트가 지우지만, 그 규칙 이전에 쌓인 데이터도 정리
for (const c of db.schedule.confirmed) dropCandidateDate(c.date);
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

// ---- 합주 일정: when2meet식 가용 시간 조율 + 확정 합주일 ----
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 가용 시간 통째 교체 — 웹(PUT)과 MCP(set_availability)가 공유.
// 15분 단위가 기본이고, 시간 단위 입력("…THH")은 quarterize가 4칸으로 펼친다 (MCP 관용 입력).
// 칠한 날짜는 후보(dates)로 자동 등록 — '날짜 올리기' 없이 바로 칠한다. 확정된 날짜 슬롯만 버린다.
function setAvailability(name, slots) {
  const confirmedDates = new Set(db.schedule.confirmed.map((c) => c.date));
  const clean = [
    ...new Set(
      slots
        .flatMap(quarterize)
        .filter((s) => Number(s.slice(11, 13)) < 24 && !confirmedDates.has(s.slice(0, 10))),
    ),
  ].sort();
  for (const d of new Set(clean.map((s) => s.slice(0, 10))))
    if (!db.schedule.dates.includes(d)) db.schedule.dates.push(d);
  db.schedule.dates.sort();
  if (clean.length) db.schedule.availability[name] = clean;
  else delete db.schedule.availability[name];
  save();
  return clean;
}

// 후보 날짜 제거 + 그 날짜에 칠한 가용 시간 스크럽 — 삭제·확정 라우트와 부팅 정리가 공유 (save는 호출자 몫)
function dropCandidateDate(date) {
  db.schedule.dates = db.schedule.dates.filter((d) => d !== date);
  for (const [name, slots] of Object.entries(db.schedule.availability)) {
    const kept = slots.filter((s) => !s.startsWith(date));
    if (kept.length) db.schedule.availability[name] = kept;
    else delete db.schedule.availability[name];
  }
}

app.get('/api/schedule', (req, res) => {
  res.json(db.schedule);
});

// 후보 날짜 추가/삭제 — 삭제 시 그 날짜에 칠해둔 가용 시간도 함께 지운다
app.post('/api/schedule/dates', (req, res) => {
  const { date } = req.body || {};
  if (!DATE_RE.test(date || ''))
    return res.status(400).json({ error: '날짜 형식이 잘못됐어요 (YYYY-MM-DD)' });
  if (db.schedule.dates.includes(date))
    return res.status(409).json({ error: '이미 올라와 있는 날짜예요' });
  db.schedule.dates.push(date);
  db.schedule.dates.sort();
  save();
  res.json(db.schedule);
});

app.delete('/api/schedule/dates', (req, res) => {
  const { date } = req.body || {};
  dropCandidateDate(date);
  save();
  res.json(db.schedule);
});

// 그리드 시간 범위 수정 — 범위 밖 슬롯은 지우지 않는다 (다시 넓히면 칠한 게 복원)
app.patch('/api/schedule', (req, res) => {
  const { startHour, endHour } = req.body || {};
  const s = Number(startHour);
  const e = Number(endHour);
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > 24 || s >= e)
    return res.status(400).json({ error: '시간 범위가 잘못됐어요' });
  db.schedule.startHour = s;
  db.schedule.endHour = e;
  save();
  res.json(db.schedule);
});

app.put('/api/schedule/availability', (req, res) => {
  const { name, slots } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '이름이 필요해요' });
  if (!Array.isArray(slots)) return res.status(400).json({ error: 'slots 배열이 필요해요' });
  setAvailability(name.trim(), slots);
  res.json(db.schedule);
});

// 합주일 확정 / 취소 — 확정하면 그 날짜는 후보에서 빠진다 (조율 끝).
// 빠질 때 슬롯이 지워지므로, 확정 시간대에 가능했던 멤버를 avail로 스냅샷해 카드가 쓴다.
app.post('/api/schedule/confirmed', (req, res) => {
  const { date, start, end, note, nickname } = req.body || {};
  if (!DATE_RE.test(date || ''))
    return res.status(400).json({ error: '날짜 형식이 잘못됐어요 (YYYY-MM-DD)' });
  const s = Number(start);
  const e = Number(end);
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > 24 || s >= e)
    return res.status(400).json({ error: '시간 범위가 잘못됐어요' });
  const inWindow = (slot) =>
    slot.startsWith(date) && Number(slot.slice(11, 13)) >= s && Number(slot.slice(11, 13)) < e;
  const avail = Object.entries(db.schedule.availability)
    .filter(([, slots]) => slots.some(inWindow))
    .map(([name]) => name);
  db.schedule.confirmed.push({
    id: crypto.randomUUID(),
    date,
    start: s,
    end: e,
    note: typeof note === 'string' ? note.trim().slice(0, 80) : '',
    by: (nickname || '').trim(),
    at: new Date().toISOString(),
    avail,
  });
  db.schedule.confirmed.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  dropCandidateDate(date);
  save();
  res.json(db.schedule);
});

app.delete('/api/schedule/confirmed/:id', (req, res) => {
  db.schedule.confirmed = db.schedule.confirmed.filter((c) => c.id !== req.params.id);
  save();
  res.json(db.schedule);
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

// ---- MCP (Model Context Protocol) — 프데(Friday) 등 에이전트 연동 ----
// Streamable HTTP 무상태 구현: POST JSON-RPC 단건, 세션·SSE 없음. 인증은 웹과 같은 x-access-code 헤더.
const MCP_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];
const MCP_TOOLS = [
  {
    name: 'list_songs',
    description:
      '합주 신청곡 전체 목록과 세션별(vocal·guitar·bass·drum·keyboard) 신청 현황을 조회한다. 곡의 song_id는 여기서 얻는다.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_song',
    description: '곡 하나의 상세 정보(세션 신청 현황 + 코멘트 전체)를 조회한다.',
    inputSchema: {
      type: 'object',
      properties: { song_id: { type: 'string', description: 'list_songs가 준 곡 id' } },
      required: ['song_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'join_session',
    description:
      '곡의 세션에 참가 신청한다. 정원이 차 있어도 신청은 접수되고 밴드가 나중에 조율한다.',
    inputSchema: {
      type: 'object',
      properties: {
        song_id: { type: 'string' },
        session: { type: 'string', enum: SESSIONS },
        name: { type: 'string', description: '신청자 이름 (합주 멤버 프로필 이름)' },
      },
      required: ['song_id', 'session', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'leave_session',
    description: '곡의 세션 참가 신청을 취소한다.',
    inputSchema: {
      type: 'object',
      properties: {
        song_id: { type: 'string' },
        session: { type: 'string', enum: SESSIONS },
        name: { type: 'string', description: '취소할 신청자 이름' },
      },
      required: ['song_id', 'session', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_schedule',
    description:
      '합주 일정 현황을 조회한다 — 확정된 합주일(confirmed), 후보 날짜(dates), 멤버별 가능 시간(availability). 슬롯 "YYYY-MM-DDTHH:MM"은 그 날짜 HH:MM부터 15분간 가능하다는 뜻 (MM은 00·15·30·45).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'set_availability',
    description:
      '멤버의 합주 가능 시간을 통째로 교체한다. slots는 15분 단위 "YYYY-MM-DDTHH:MM" 목록(MM은 00·15·30·45). 시간 단위 "YYYY-MM-DDTHH"를 주면 그 한 시간 전체(4칸)로 펼쳐진다. 칠한 날짜는 후보(dates)로 자동 등록되고, 이미 확정된 날짜의 슬롯만 버려진다. 빈 배열이면 전부 지운다.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '멤버 이름 (합주 멤버 프로필 이름)' },
        slots: { type: 'array', items: { type: 'string' } },
      },
      required: ['name', 'slots'],
      additionalProperties: false,
    },
  },
];

function songSummary(s) {
  const sessions = {};
  for (const k of SESSIONS) sessions[k] = { capacity: s.slots[k], applicants: s.members[k] };
  return {
    id: s.id,
    title: s.title,
    artist: s.artist,
    link: s.link,
    sessions,
    commentCount: (s.comments || []).length,
    createdBy: s.createdBy,
    createdAt: s.createdAt,
  };
}

// 에이전트가 넘긴 이름을 멤버 프로필과 대조 — 오타로 유령 신청자가 생기는 것 방지 (프로필이 없으면 그대로 신뢰)
function canonicalMember(name) {
  const raw = typeof name === 'string' ? name.trim() : '';
  if (!raw) return { error: '이름이 필요해요' };
  let members = [];
  try {
    members =
      JSON.parse(fs.readFileSync(path.join(__dirname, 'members.json'), 'utf8')).members || [];
  } catch {
    // members.json 없음 — 서버는 원래 이름을 강제하지 않는다
  }
  if (!members.length) return { name: raw };
  const hit = members.find((m) => m.name.toLowerCase() === raw.toLowerCase());
  if (hit) return { name: hit.name };
  return { error: `등록된 멤버가 아니에요. 가능한 이름: ${members.map((m) => m.name).join(', ')}` };
}

function mcpToolResult(payload, isError) {
  return {
    content: [
      { type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

function runMcpTool(name, args) {
  if (name === 'list_songs')
    return mcpToolResult({ sessions: SESSIONS, songs: db.songs.map(songSummary) });
  if (name === 'get_schedule') return mcpToolResult(db.schedule);
  if (name === 'set_availability') {
    if (!Array.isArray(args.slots)) return mcpToolResult('slots 배열이 필요해요', true);
    const who = canonicalMember(args.name);
    if (who.error) return mcpToolResult(who.error, true);
    const saved = setAvailability(who.name, args.slots);
    return mcpToolResult({
      ok: true,
      message: `${who.name}의 가능 시간을 ${saved.length}칸으로 갱신했어요`,
      schedule: db.schedule,
    });
  }
  if (name === 'get_song') {
    const song = db.songs.find((s) => s.id === args.song_id);
    if (!song) return mcpToolResult('곡을 찾을 수 없어요', true);
    return mcpToolResult({ ...songSummary(song), comments: song.comments });
  }
  if (name === 'join_session' || name === 'leave_session') {
    const song = db.songs.find((s) => s.id === args.song_id);
    if (!song) return mcpToolResult('곡을 찾을 수 없어요', true);
    if (!SESSIONS.includes(args.session))
      return mcpToolResult(`없는 세션이에요. 가능한 세션: ${SESSIONS.join(', ')}`, true);
    const who = canonicalMember(args.name);
    if (who.error) return mcpToolResult(who.error, true);
    const list = song.members[args.session];
    if (name === 'join_session') {
      if (list.includes(who.name)) return mcpToolResult('이미 신청되어 있어요', true);
      list.push(who.name);
      save();
      const over = list.length > song.slots[args.session];
      return mcpToolResult({
        ok: true,
        message: `"${song.title}" ${args.session}에 ${who.name} 신청 완료${over ? ' (정원 초과 — 밴드가 조율할 예정)' : ''}`,
        song: songSummary(song),
      });
    }
    if (!list.includes(who.name)) return mcpToolResult('신청되어 있지 않아요', true);
    song.members[args.session] = list.filter((n) => n !== who.name);
    save();
    return mcpToolResult({
      ok: true,
      message: `"${song.title}" ${args.session}에서 ${who.name} 신청 취소 완료`,
      song: songSummary(song),
    });
  }
  return null;
}

app.get('/mcp', (req, res) => res.status(405).end()); // SSE 스트림 미지원
app.post('/mcp', (req, res) => {
  let header = req.get('x-access-code') || '';
  try {
    header = decodeURIComponent(header);
  } catch {
    // 인코딩 깨진 헤더는 그대로 비교 → 아래에서 401
  }
  if (!codeMatches(header)) return res.status(401).json({ error: '인증이 필요해요' });
  const msg = req.body;
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string')
    return res
      .status(400)
      .json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
  if (msg.id === undefined) return res.status(202).end(); // notification은 접수만
  const reply = (result) => res.json({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.method === 'initialize') {
    const requested = msg.params?.protocolVersion;
    return reply({
      protocolVersion: MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'concert', title: '합주 세트리스트', version: '1.0.0' },
    });
  }
  if (msg.method === 'ping') return reply({});
  if (msg.method === 'tools/list') return reply({ tools: MCP_TOOLS });
  if (msg.method === 'tools/call') {
    let result;
    try {
      result = runMcpTool(msg.params?.name, msg.params?.arguments || {});
    } catch (e) {
      result = mcpToolResult(`처리 중 오류: ${e.message}`, true);
    }
    if (result) return reply(result);
    return res.json({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32602, message: `Unknown tool: ${msg.params?.name}` },
    });
  }
  res.json({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
});

app.listen(PORT, () => {
  console.log(`🎸 concert running on http://localhost:${PORT}`);
});
