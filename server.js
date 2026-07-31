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
app.use(express.static(path.join(__dirname, 'public')));

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
    link: (link || '').trim(),
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
  if (link !== undefined) song.link = link.trim();
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

app.listen(PORT, () => {
  console.log(`🎸 concert running on http://localhost:${PORT}`);
});
