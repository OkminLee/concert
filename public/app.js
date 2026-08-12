const SESSION_META = {
  vocal: { tag: 'V', label: '보컬' },
  guitar: { tag: 'G', label: '기타' },
  bass: { tag: 'B', label: '베이스' },
  drum: { tag: 'D', label: '드럼' },
  keyboard: { tag: 'K', label: '키보드' },
};
const SESSIONS = Object.keys(SESSION_META);
const DEFAULT_SLOTS = { vocal: 1, guitar: 2, bass: 1, drum: 1, keyboard: 1 };

const $ = (sel, el = document) => el.querySelector(sel);
let me = localStorage.getItem('nickname') || '';
let songs = [];
let members = [];
let editingId = null;

const REACTION_EMOJIS = ['👍', '❤️', '🔥', '😂', '👀', '🎸'];
const avatarOf = (name) => members.find((m) => m.name === name)?.avatar;
const avatarImg = (name, cls = 'avatar-s') => {
  const src = avatarOf(name);
  return src
    ? `<img class="${cls}" src="${esc(src)}" alt="" width="18" height="18" decoding="async" />`
    : '';
};

const ICONS = {
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4"/></svg>',
  caret: '<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H4l2.5-2.7A8 8 0 1 1 21 12Z"/></svg>',
  playlist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15V6M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM12 12H3M16 6H3M12 18H3"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
};

const expanded = new Set(); // 펼쳐진 곡 id — 재렌더에도 유지
let filter = 'all'; // 상태 필터: all | open | full
let mineOnly = false; // '내 곡' 토글 — 상태 필터와 독립 조합
let query = '';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );

let accessCode = localStorage.getItem('accesscode') || '';

// 인증 해제 — 401 복귀와 수동 초기화가 같은 경로를 쓴다
function clearAuth() {
  accessCode = '';
  localStorage.removeItem('accesscode');
  $('#auth-code').value = '';
  $('#auth-msg').hidden = true;
  // 모달이 top layer에 떠 있으면 게이트가 inert로 가려진다 → 먼저 닫기
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  syncGate();
}

async function api(path, method = 'GET', body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (accessCode) headers['x-access-code'] = encodeURIComponent(accessCode); // 비ASCII 코드도 헤더 안전
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/auth') clearAuth();
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

/* ── 로그인 게이트 ── */
function syncGate() {
  const authed = !!accessCode;
  $('#gate').classList.toggle('hidden', authed && !!me);
  $('#gate-auth').hidden = authed;
  $('#gate-enter').hidden = !authed;
  $('#btn-me').innerHTML = me ? `${avatarImg(me)}${esc(me)}${avatarOf(me) ? '' : ` ${ICONS.mic}`}` : '';
  if (!authed) $('#auth-code').focus();
  else if (!me) $('#gate-name').focus();
}
// 인증코드 확인 (1단계)
$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#auth-code').value.trim();
  if (!code) return;
  const msg = $('#auth-msg');
  try {
    await api('/api/auth', 'POST', { code });
    accessCode = code;
    localStorage.setItem('accesscode', code);
    msg.hidden = true;
    syncGate();
    initData();
  } catch (err) {
    msg.textContent = err.message;
    msg.hidden = false;
    const ticket = $('#ticket');
    ticket.classList.remove('shake');
    void ticket.offsetWidth; // reflow로 애니메이션 재시작
    ticket.classList.add('shake');
  }
});
// Slack #yb 프로필로 입장 — 선택은 localStorage에 저장되어 다음 입장부터 생략
function renderGateProfiles() {
  $('#gate-profiles').innerHTML = members
    .map(
      (m) => `
        <button type="button" class="profile" data-name="${esc(m.name)}">
          <img src="${esc(m.avatar)}" alt="" loading="lazy" />
          <span>${esc(m.name)}</span>
        </button>`,
    )
    .join('');
  $('#gate-or').hidden = !members.length;
}
function login(name) {
  me = name;
  localStorage.setItem('nickname', me);
  syncGate();
  render(); // 내 곡 카운트·칩 하이라이트·참가 버튼 등 me 의존 UI 갱신
}
$('#gate-profiles').addEventListener('click', (e) => {
  const btn = e.target.closest('.profile');
  if (btn) login(btn.dataset.name);
});
$('#gate-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#gate-name').value.trim();
  if (name) login(name);
});
$('#btn-me').addEventListener('click', () => {
  localStorage.removeItem('nickname');
  me = '';
  $('#gate-name').value = '';
  syncGate();
  render();
});
// 인증 정보 초기화 — 저장된 인증코드를 지우고 티켓 단계로 복귀
$('#btn-reset-auth').addEventListener('click', clearAuth);

/* ── 세션 정원 스테퍼 ── */
function renderSteppers(container, slots) {
  container.innerHTML = SESSIONS.map((s) => {
    const m = SESSION_META[s];
    return `
      <div class="stepper ${slots[s] === 0 ? 'zero' : ''}" data-session="${s}">
        <span class="tag ${s}" title="${m.label}">${m.tag}</span>
        <div class="stepper-controls">
          <button type="button" data-d="-1" aria-label="${m.label} 인원 줄이기">−</button>
          <output>${slots[s]}</output>
          <button type="button" data-d="1" aria-label="${m.label} 인원 늘리기">+</button>
        </div>
      </div>`;
  }).join('');
}
function stepperValues(container) {
  const slots = {};
  container.querySelectorAll('.stepper').forEach((el) => {
    slots[el.dataset.session] = Number($('output', el).value || $('output', el).textContent);
  });
  return slots;
}
function bindStepper(container) {
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-d]');
    if (!btn) return;
    const out = $('output', btn.closest('.stepper'));
    const next = Math.max(0, Math.min(9, Number(out.textContent) + Number(btn.dataset.d)));
    out.textContent = next;
    btn.closest('.stepper').classList.toggle('zero', next === 0);
  });
}

/* ── 곡 적기 ── */
renderSteppers($('#f-slots'), { ...DEFAULT_SLOTS });
bindStepper($('#f-slots'));

// 링크 붙여넣기만 해도 자동 인식 실행
$('#f-link').addEventListener('paste', () => setTimeout(() => $('#btn-parse').click(), 60));

$('#btn-parse').addEventListener('click', async () => {
  const url = $('#f-link').value.trim();
  const msg = $('#parse-msg');
  msg.hidden = false;
  msg.classList.remove('err');
  if (!url) {
    msg.textContent = '링크를 먼저 붙여넣어주세요';
    msg.classList.add('err');
    return;
  }
  const btn = $('#btn-parse');
  btn.disabled = true;
  msg.textContent = '링크에서 곡 정보를 읽는 중…';
  try {
    const { artist, title } = await api('/api/parse-link', 'POST', { url });
    $('#f-artist').value = artist;
    $('#f-title').value = title;
    msg.textContent = '자동으로 채웠어요 — 틀린 부분은 고쳐주세요!';
  } catch (err) {
    msg.textContent = err.message;
    msg.classList.add('err');
  } finally {
    btn.disabled = false;
  }
});

$('#song-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const song = await api('/api/songs', 'POST', {
      title: $('#f-title').value,
      artist: $('#f-artist').value,
      link: $('#f-link').value,
      slots: stepperValues($('#f-slots')),
      nickname: me,
    });
    $('#song-form').reset();
    $('#parse-msg').hidden = true;
    renderSteppers($('#f-slots'), { ...DEFAULT_SLOTS });
    setComposer(false);
    expanded.add(song.id); // 방금 올린 곡은 펼쳐서 보여준다
    filter = 'all'; // 활성 필터·검색이 새 곡을 숨기지 않도록 초기화
    mineOnly = false; // 새 곡은 세션 신청 전이라 토글이 켜져 있으면 숨겨진다
    query = '';
    $('#search').value = '';
    await load();
  } catch (err) {
    alert(err.message);
  }
});

/* ── 곡 적기 접기/펼치기 ── */
$('#composer-toggle').insertAdjacentHTML('beforeend', ICONS.caret); // 캐럿 아이콘은 ICONS 단일 정의
function setComposer(open) {
  $('#composer').classList.toggle('open', open);
  $('#composer-toggle').setAttribute('aria-expanded', open);
}
$('#composer-toggle').addEventListener('click', () => {
  const open = !$('#composer').classList.contains('open');
  setComposer(open);
  if (open) $('#f-link').focus();
});

/* ── 필터·검색 ── */
$('#filters').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter');
  if (!btn) return;
  if (btn.dataset.filter === 'mine') mineOnly = !mineOnly;
  else filter = btn.dataset.filter; // 활성 표시는 render → filterCounts가 파생
  render();
});
$('#search').addEventListener('input', (e) => {
  query = e.target.value.trim().toLowerCase();
  render();
});

/* ── 곡 리스트 ── */
function remainInfo(song) {
  const need = SESSIONS.reduce((a, s) => a + song.slots[s], 0);
  if (need === 0) return { cls: 'none', text: '정원 미정' };
  const have = SESSIONS.reduce((a, s) => a + Math.min(song.members[s].length, song.slots[s]), 0);
  const remain = need - have;
  if (remain <= 0) return { cls: 'full', text: '모집 완료 ✓' };
  if (remain <= 2) return { cls: 'some', text: `${remain}명 남음` };
  return { cls: 'many', text: `${remain}명 남음` };
}

// 세션 충원 상태 — 행 요약(minis)과 펼침 세션 행이 같은 규칙을 공유한다
const activeSessions = (song) =>
  SESSIONS.filter((s) => song.slots[s] > 0 || song.members[s].length > 0);
function sessionStat(song, s) {
  const cap = song.slots[s];
  const cnt = song.members[s].length;
  return { cap, cnt, cls: cnt > cap ? 'over' : cnt === cap && cap > 0 ? 'filled' : '' };
}

/* ── 무대 포지션 렌더 ── */
// 자리 1개 — 빈 자리는 join, 채워진 자리는 leave (본인/타인 confirm은 기존 핸들러가 분기)
function spotHTML(s, name, over) {
  // 'empty'는 빈 목록 상태 박스(.empty)와 충돌 — 빈 자리는 free
  if (name === undefined)
    return `<button type="button" class="spot free ${over ? 'over' : ''}" data-act="join" data-session="${s}"
      aria-label="${SESSION_META[s].label} ${over ? '정원 초과 지원' : '참가'}"${over ? ' title="정원보다 많아도 올라갈 수 있어요"' : ''}>+</button>`;
  const ava =
    avatarImg(name, 'spot-ava') || `<span class="spot-initial">${esc(name.slice(0, 1))}</span>`;
  return `
    <button type="button" class="spot filled ${name === me ? 'me' : ''} ${over ? 'over' : ''}"
      data-act="leave" data-session="${s}" data-name="${esc(name)}"
      title="${esc(name)}" aria-label="${esc(name)} 빼기">
      ${ava}<span class="nm">${esc(name)}</span>
    </button>`;
}
// 객석에서 본 무대 — 정원만큼 빈 자리를 깔고, 초과 인원은 over 자리로 이어붙인다
function stageHTML(song) {
  const act = activeSessions(song);
  if (!act.length)
    return '<p class="count">세션 정원이 아직 없어요 — 수정 버튼으로 채워주세요</p>';
  const zones = act
    .map((s) => {
      const m = SESSION_META[s];
      const { cap, cnt, cls } = sessionStat(song, s);
      const spots = [];
      for (let i = 0; i < Math.max(cap, cnt); i++)
        spots.push(spotHTML(s, song.members[s][i], i >= cap));
      // 기존 행 UI처럼 정원이 차도 초과 지원 가능 — 빈 자리가 없으면 초과 자리를 하나 연다 (내가 이미 있으면 생략)
      if (cnt >= cap && !song.members[s].includes(me)) spots.push(spotHTML(s, undefined, true));
      return `
        <div class="zone ${s}">
          <span class="zone-label"><i class="dot ${s}"></i>${m.label} <b class="${cls}">${cnt}/${cap}</b></span>
          <div class="spots">${spots.join('')}</div>
        </div>`;
    })
    .join('');
  return `<div class="stage"><div class="stage-grid">${zones}</div><div class="stage-edge">AUDIENCE · 객석</div></div>`;
}

// 유튜브 링크면 카드 안에서 바로 재생할 수 있게 임베드
function youtubeId(url) {
  const m = (url || '').match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/,
  );
  return m ? m[1] : null;
}
const playerHTML = (videoId) =>
  `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}" title="YouTube 플레이어" allow="encrypted-media; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe>`;

// 필터 분류 — 목록 필터링과 칩 카운트가 같은 술어를 공유한다
const isMine = (song) => SESSIONS.some((s) => song.members[s].includes(me));
function inCategory(song, name) {
  if (name === 'open') {
    const cls = remainInfo(song).cls;
    return cls === 'some' || cls === 'many';
  }
  if (name === 'full') return remainInfo(song).cls === 'full';
  return true;
}

function songCard(song, idx) {
  const remain = remainInfo(song);

  const comments = song.comments
    .map((c) => {
      const rx = c.reactions || {};
      const reactChips = Object.entries(rx)
        .map(
          ([emoji, names]) => `
            <button type="button" class="react ${names.includes(me) ? 'mine' : ''}"
              data-act="react" data-cid="${c.id}" data-emoji="${esc(emoji)}"
              title="${esc(names.join(', '))}">${esc(emoji)} ${names.length}</button>`,
        )
        .join('');
      const palette = REACTION_EMOJIS.map(
        (e) => `<button type="button" data-act="react" data-cid="${c.id}" data-emoji="${e}">${e}</button>`,
      ).join('');
      return `
        <div class="comment">
          <span class="author">${avatarImg(c.author)}${esc(c.author)}</span>
          <span class="text">${esc(c.text)}</span>
          <span class="reacts">
            ${reactChips}
            <span class="react-add-wrap">
              <button type="button" class="react add" data-act="react-toggle" aria-label="리액션 추가">+</button>
              <span class="palette">${palette}</span>
            </span>
          </span>
          ${c.author === me ? `<button type="button" class="icon-btn" data-act="del-comment" data-cid="${c.id}" aria-label="코멘트 삭제">✕</button>` : ''}
        </div>`;
    })
    .join('');

  const open = expanded.has(song.id);
  // 접힌 행의 세션 요약: 세션색 점 + 충원 현황 (모바일에선 점만)
  const minis = activeSessions(song)
    .map((s) => {
      const { cap, cnt, cls } = sessionStat(song, s);
      const label = `${SESSION_META[s].label} ${cnt}/${cap}`;
      return `<span class="mini ${cls}" title="${label}" aria-label="${label}"><i class="dot ${s}"></i><span class="mini-num">${cnt}/${cap}</span></span>`;
    })
    .join('');
  const cmt = song.comments.length
    ? `<span class="mini cmt" title="코멘트 ${song.comments.length}개">${ICONS.comment}<span class="mini-num">${song.comments.length}</span></span>`
    : '';

  return `
    <article class="song ${open ? 'open' : ''}" data-id="${song.id}">
      <button type="button" class="row-head" data-act="toggle" aria-expanded="${open}">
        <span class="song-no">${String(idx + 1).padStart(2, '0')}</span>
        <span class="row-title">
          <strong>${esc(song.title)}</strong>
          ${song.artist ? `<em>${esc(song.artist)}</em>` : ''}
        </span>
        <span class="leader" aria-hidden="true"></span>
        <span class="row-mini">${minis}${cmt}</span>
        <span class="badge-remain ${remain.cls}">${remain.text}</span>
        ${ICONS.caret}
      </button>
      <div class="song-detail">
        <div class="song-detail-inner">
          <div class="detail-top">
            <span class="detail-foot">${song.artist ? `${esc(song.artist)} · ` : ''}제안 ${esc(song.createdBy)}</span>
            <span class="detail-meta">
              ${song.link ? `<a href="${esc(song.link)}" target="_blank" rel="noopener">곡 듣기 ↗</a>` : ''}
              <button type="button" class="icon-btn" data-act="edit" title="수정">${ICONS.pencil}</button>
              <button type="button" class="icon-btn" data-act="delete" title="삭제">${ICONS.trash}</button>
            </span>
          </div>
          ${(() => {
            const vid = youtubeId(song.link);
            // 접힘 상태에선 iframe을 비워 재생·로드 방지, 펼칠 때 toggle에서 주입
            return vid ? `<div class="player" data-video="${vid}">${open ? playerHTML(vid) : ''}</div>` : '';
          })()}
          <div class="song-body">
            <div class="sessions">${stageHTML(song)}</div>
            <div class="comments">
              ${comments}
              <form class="comment-form" data-act="comment">
                <input type="text" maxlength="200" placeholder="하고 싶은 말" autocomplete="off" />
                <button type="submit">남기기</button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </article>`;
}

function matchesFilter(song) {
  if (!inCategory(song, filter)) return false;
  if (mineOnly && !isMine(song)) return false;
  if (query) {
    const haystack =
      `${song.title} ${song.artist} ${SESSIONS.flatMap((s) => song.members[s]).join(' ')}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

// 칩 카운트·활성 표시는 렌더마다 파생 — 숫자는 "그 칩을 눌렀을 때 보게 될 곡 수"
function filterCounts() {
  $('#filters')
    .querySelectorAll('.filter')
    .forEach((b) => {
      const mine = b.dataset.filter === 'mine';
      $('.cnt', b).textContent = mine
        ? songs.filter((s) => isMine(s) && inCategory(s, filter)).length
        : songs.filter((s) => inCategory(s, b.dataset.filter) && (!mineOnly || isMine(s))).length;
      b.classList.toggle('on', mine ? mineOnly : b.dataset.filter === filter);
    });
}

// keyed diff 렌더 — 바뀐 카드만 DOM 교체 (이미지 재로드·애니메이션 재생 방지)
const cardCache = new Map(); // song.id -> 마지막 렌더 HTML

function render() {
  const container = $('#songs');
  for (const id of [...expanded]) if (!songs.some((s) => s.id === id)) expanded.delete(id);
  const visible = songs.map((s, i) => ({ s, i })).filter(({ s }) => matchesFilter(s));
  filterCounts();
  $('#song-count').textContent = !songs.length
    ? ''
    : visible.length === songs.length
      ? `— ${songs.length}곡`
      : `— ${visible.length}/${songs.length}곡`;
  if (!songs.length || !visible.length) {
    cardCache.clear();
    container.innerHTML = !songs.length
      ? '<div class="empty">아직 곡이 없어요. 첫 곡을 올려주세요!</div>'
      : '<div class="empty">조건에 맞는 곡이 없어요<br /><button type="button" class="ghost" id="clear-filter">필터 초기화</button></div>';
    return;
  }
  container.querySelector('.empty')?.remove();
  const seen = new Set();
  let anchor = null;
  for (const { s, i } of visible) {
    seen.add(s.id);
    const html = songCard(s, i);
    let el = container.querySelector(`[data-id="${s.id}"]`);
    if (!el || cardCache.get(s.id) !== html) {
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      const fresh = tpl.content.firstElementChild;
      if (el) el.replaceWith(fresh);
      else container.appendChild(fresh);
      el = fresh;
    }
    cardCache.set(s.id, html);
    if (anchor) {
      if (anchor.nextElementSibling !== el) anchor.after(el);
    } else if (container.firstElementChild !== el) {
      container.prepend(el);
    }
    anchor = el;
  }
  for (const el of [...container.querySelectorAll('.song')]) {
    if (!seen.has(el.dataset.id)) {
      cardCache.delete(el.dataset.id);
      el.remove();
    }
  }
}

// 서버 응답 곡 하나를 반영 — keyed diff가 해당 카드만 교체
function updateCard(song) {
  const idx = songs.findIndex((s) => s.id === song.id);
  if (idx !== -1) songs[idx] = song;
  render();
}

let firstPaint = true;
async function load() {
  songs = (await api('/api/songs')).songs;
  if (firstPaint) {
    // 등장 애니메이션은 최초 로드에만 — 이후 렌더에선 재생 안 함
    firstPaint = false;
    $('#songs').classList.add('intro');
    setTimeout(() => $('#songs').classList.remove('intro'), 700);
  }
  render();
}

// 폴링: 변경 없으면 재렌더 생략, 변경 시 작성 중이던 코멘트 입력 보존
async function poll() {
  const next = (await api('/api/songs')).songs;
  if (JSON.stringify(next) === JSON.stringify(songs)) return;
  const active = document.activeElement;
  const editing =
    active?.matches?.('.comment-form input') && active.value
      ? { id: active.closest('.song')?.dataset.id, value: active.value }
      : null;
  songs = next;
  render();
  if (editing?.id) {
    const input = $(`.song[data-id="${editing.id}"] .comment-form input`);
    if (input) {
      input.value = editing.value;
      input.focus();
    }
  }
}

/* ── 카드 내 액션 (이벤트 위임) ── */
$('#songs').addEventListener('click', async (e) => {
  if (e.target.closest('#clear-filter')) {
    filter = 'all';
    mineOnly = false;
    query = '';
    $('#search').value = '';
    render();
    return;
  }
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('.song');
  const id = card.dataset.id;
  const song = songs.find((s) => s.id === id);
  try {
    switch (btn.dataset.act) {
      case 'toggle': {
        // DOM 재생성 없이 클래스만 토글 — 깜빡임 제거
        const willOpen = !expanded.has(id);
        if (willOpen) expanded.add(id);
        else expanded.delete(id);
        card.classList.toggle('open', willOpen);
        btn.setAttribute('aria-expanded', willOpen);
        const player = card.querySelector('.player');
        if (player) player.innerHTML = willOpen ? playerHTML(player.dataset.video) : ''; // 접으면 재생 중지
        cardCache.set(id, songCard(song, songs.findIndex((s) => s.id === id)));
        return;
      }
      case 'join':
        updateCard(
          await api(`/api/songs/${id}/members`, 'POST', {
            session: btn.dataset.session,
            name: me,
          }),
        );
        break;
      case 'leave': {
        const name = btn.dataset.name;
        if (name !== me && !confirm(`${name} 님을 빼시겠어요?`)) return;
        updateCard(
          await api(`/api/songs/${id}/members`, 'DELETE', {
            session: btn.dataset.session,
            name,
          }),
        );
        break;
      }
      case 'delete':
        if (!confirm(`"${song.title}" 곡을 지우시겠어요?`)) return;
        await api(`/api/songs/${id}`, 'DELETE');
        await load();
        break;
      case 'del-comment':
        updateCard(await api(`/api/songs/${id}/comments/${btn.dataset.cid}`, 'DELETE'));
        break;
      case 'react':
        updateCard(
          await api(`/api/songs/${id}/comments/${btn.dataset.cid}/react`, 'POST', {
            emoji: btn.dataset.emoji,
            name: me,
          }),
        );
        break;
      case 'react-toggle':
        btn.parentElement.classList.toggle('open');
        return;
      case 'edit':
        openEdit(song);
        return;
    }
  } catch (err) {
    if (!accessCode) return; // 401로 게이트 복귀 중 — 알림·재요청 생략
    alert(err.message);
    await load();
  }
});

$('#songs').addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-act="comment"]');
  if (!form) return;
  e.preventDefault();
  const input = $('input', form);
  if (!input.value.trim()) return;
  const id = form.closest('.song').dataset.id;
  try {
    updateCard(await api(`/api/songs/${id}/comments`, 'POST', { author: me, text: input.value }));
  } catch (err) {
    if (!accessCode) return;
    alert(err.message);
  }
});

/* ── 곡 수정 다이얼로그 ── */
function openEdit(song) {
  editingId = song.id;
  $('#e-title').value = song.title;
  $('#e-artist').value = song.artist;
  $('#e-link').value = song.link;
  renderSteppers($('#e-slots'), song.slots);
  $('#edit-dialog').showModal();
}
bindStepper($('#e-slots'));
$('#edit-cancel').addEventListener('click', () => $('#edit-dialog').close());
$('#edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    updateCard(
      await api(`/api/songs/${editingId}`, 'PATCH', {
        title: $('#e-title').value,
        artist: $('#e-artist').value,
        link: $('#e-link').value,
        slots: stepperValues($('#e-slots')),
      }),
    );
    $('#edit-dialog').close();
  } catch (err) {
    alert(err.message);
  }
});

/* ── 사용법 ── */
$('#btn-help').addEventListener('click', () => $('#help-dialog').showModal());
$('#help-close').addEventListener('click', () => $('#help-dialog').close());

/* ── 개선 제안 → GitHub 이슈 ── */
$('#btn-feedback').addEventListener('click', () => {
  $('#fb-msg').hidden = true;
  $('#feedback-dialog').showModal();
});
$('#fb-cancel').addEventListener('click', () => $('#feedback-dialog').close());
$('#feedback-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#fb-msg');
  msg.hidden = false;
  msg.classList.remove('err');
  msg.textContent = '이슈를 만드는 중…';
  try {
    const { url } = await api('/api/feedback', 'POST', {
      title: $('#fb-title').value,
      detail: $('#fb-detail').value,
      nickname: me,
    });
    msg.innerHTML = `등록됐어요! <a href="${esc(url)}" target="_blank" rel="noopener">이슈 보기 ↗</a>`;
    $('#feedback-form').reset();
  } catch (err) {
    msg.textContent = err.message;
    msg.classList.add('err');
  }
});

/* ── 플레이리스트 추출 ── */
$('#btn-export').insertAdjacentHTML('afterbegin', ICONS.playlist);
$('#x-copy-name').innerHTML = ICONS.copy;

let exportConfig = null; // /api/export-config 응답 캐시
const FILTER_LABEL = { open: '모집 중', full: '모집 완료' };
function autoPlaylistName() {
  const d = new Date();
  const label =
    (FILTER_LABEL[filter] ? ` · ${FILTER_LABEL[filter]}` : '') + (mineOnly ? ' · 내 곡' : '');
  return `합주 세트리스트 ${d.getMonth() + 1}.${d.getDate()}${label}`;
}
const exportSelection = () =>
  [...document.querySelectorAll('#x-songs input:checked')]
    .map((cb) => songs.find((s) => s.id === cb.value))
    .filter(Boolean);
const playlistText = (sel) =>
  sel.map((s) => (s.artist ? `${s.artist} - ${s.title}` : s.title)).join('\n');

function exportMsg(html, err = false) {
  const msg = $('#x-msg');
  msg.hidden = false;
  msg.classList.toggle('err', err);
  msg.innerHTML = html;
}

// 선택 변경마다 카운트·버튼 상태·서비스별 힌트를 다시 계산
function syncExport() {
  const sel = exportSelection();
  const searched = sel.filter((s) => !youtubeId(s.link)).length;
  $('#x-count').textContent = sel.length ? `— ${sel.length}곡 선택` : '';
  $('#x-youtube').disabled = $('#x-spotify').disabled = $('#x-apple').disabled = !sel.length;
  $('#x-yt-hint').textContent = !searched
    ? '임시 재생목록으로 열어요'
    : `임시 재생목록으로 열어요 — 링크 없는 ${searched}곡은 검색해서 채워요`;
  const apple = !!exportConfig?.appleDeveloperToken;
  $('#x-apple').textContent = apple ? '추가하기' : '목록 복사';
  $('#x-apple-hint').textContent = apple
    ? 'Apple Music 계정으로 로그인해 바로 만들어요'
    : '뮤지션 - 곡명 목록을 복사해요';
}

$('#btn-export').addEventListener('click', async () => {
  $('#x-name').value = autoPlaylistName();
  $('#x-songs').innerHTML =
    songs
      .filter(matchesFilter) // 현재 필터·검색이 그대로 추출 범위
      .map(
        (s, i) => `
          <label class="export-song">
            <input type="checkbox" value="${s.id}" checked />
            <span class="x-no">${String(i + 1).padStart(2, '0')}</span>
            <strong>${esc(s.title)}</strong>
            ${s.artist ? `<em>${esc(s.artist)}</em>` : ''}
            <span class="x-leader" aria-hidden="true"></span>
            ${youtubeId(s.link) ? '' : '<span class="no-link" title="유튜브 링크가 없어 검색 1위 결과로 채워요">검색 추가</span>'}
          </label>`,
      )
      .join('') || '<p class="parse-msg">현재 필터에 곡이 없어요 — 필터를 바꿔보세요</p>';
  $('#x-msg').hidden = true;
  syncExport();
  $('#export-dialog').showModal(); // 포커스는 dialog 내 autofocus 컨테이너로 — 이름 입력에 가면 모바일 키보드가 버튼을 가린다
  if (!exportConfig) {
    try {
      exportConfig = await api('/api/export-config');
      syncExport(); // Apple 행을 설정 상태에 맞게 갱신
      if (exportConfig.appleDeveloperToken) ensureMusic().catch(() => {}); // 클릭 전 미리 로드 — authorize 팝업 차단 방지
    } catch {
      exportConfig = { appleDeveloperToken: null };
    }
  }
});
$('#x-songs').addEventListener('change', syncExport);
$('#x-close').addEventListener('click', () => $('#export-dialog').close());

$('#x-copy-name').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#x-name').value.trim());
    exportMsg('플레이리스트 이름을 복사했어요');
  } catch {
    exportMsg('복사가 안 돼요 — 이름을 직접 드래그해서 복사해주세요', true);
  }
});

// 링크 없는 곡은 서버 경유로 유튜브 검색해 채운다 — 성공만 캐시(실패는 재시도 가능하게)
const ytFoundCache = new Map(); // song.id -> videoId
async function resolveYoutubeIds(sel) {
  const missing = sel.filter((s) => !youtubeId(s.link) && !ytFoundCache.has(s.id));
  let done = 0;
  for (const s of missing) {
    exportMsg(`유튜브에서 검색 중… ${++done}/${missing.length}`);
    try {
      const { videoId } = await api('/api/search-youtube', 'POST', {
        q: `${s.artist} ${s.title}`.trim(),
      });
      ytFoundCache.set(s.id, videoId);
    } catch {
      // 못 찾은 곡은 제외하고 진행
    }
  }
  return sel.map((s) => youtubeId(s.link) || ytFoundCache.get(s.id)).filter(Boolean);
}

// 유튜브 익명 임시 재생목록 — 로그인 없이 생성, '저장'하면 내 계정에 담긴다 (최대 50곡)
$('#x-youtube').addEventListener('click', async () => {
  const sel = exportSelection();
  const win = window.open('', '_blank'); // 검색 대기 후 window.open은 팝업 차단됨 → 클릭 시점에 미리 연다
  $('#x-youtube').disabled = true;
  try {
    const ids = await resolveYoutubeIds(sel);
    if (!ids.length) {
      win?.close();
      exportMsg('유튜브에서 곡을 찾지 못했어요', true);
      return;
    }
    const url = `https://www.youtube.com/watch_videos?video_ids=${ids.slice(0, 50).join(',')}`;
    if (win) {
      win.opener = null;
      win.location = url;
    }
    const missed = sel.length - ids.length;
    exportMsg(
      (ids.length > 50 ? '유튜브 임시 재생목록은 50곡까지라 앞의 50곡만 열었어요' :
        `재생목록을 열었어요${missed ? ` (${missed}곡은 검색에서 못 찾음)` : ''}`) +
        ` — 메뉴의 '재생목록에 저장' 후 이름을 "${esc($('#x-name').value.trim())}"로 지어주세요`,
    );
  } finally {
    $('#x-youtube').disabled = false;
  }
});

/* Apple Music 직접 생성 — 서버 developer token + MusicKit 사용자 로그인 */
let musickitLoading = null;
let musicConfigured = false;
function loadMusicKit() {
  if (window.MusicKit) return Promise.resolve();
  if (!musickitLoading) {
    musickitLoading = new Promise((resolve, reject) => {
      document.addEventListener('musickitloaded', () => resolve(), { once: true });
      const s = document.createElement('script');
      s.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
      s.async = true;
      s.onerror = () => {
        musickitLoading = null;
        reject(new Error('MusicKit 스크립트를 불러오지 못했어요'));
      };
      document.head.appendChild(s);
    });
  }
  return musickitLoading;
}
async function ensureMusic() {
  await loadMusicKit();
  if (!musicConfigured) {
    await MusicKit.configure({
      developerToken: exportConfig.appleDeveloperToken,
      app: { name: '합주 세트리스트', build: '1' },
    });
    musicConfigured = true;
  }
  return MusicKit.getInstance();
}

$('#x-apple').addEventListener('click', async () => {
  const sel = exportSelection();
  if (!exportConfig?.appleDeveloperToken) {
    // 서버 키 미설정 — 목록 복사로 동작
    try {
      await navigator.clipboard.writeText(playlistText(sel));
      exportMsg(`${sel.length}곡을 복사했어요`);
    } catch {
      exportMsg('복사가 안 돼요 — 다시 시도해주세요', true);
    }
    return;
  }
  const name = $('#x-name').value.trim() || autoPlaylistName();
  $('#x-apple').disabled = true;
  try {
    exportMsg('Apple Music에 연결하는 중…');
    const music = await ensureMusic();
    // 팝업이 차단되면 authorize가 영원히 매달린다 — 3초 뒤에도 이 창에 포커스가 있으면 차단으로 판단
    // (팝업이 열렸다면 포커스를 뺏기므로 오탐 없음. 로그인 창이 떠 있으면 얼마든지 기다린다)
    await Promise.race([
      music.authorize(),
      new Promise((_, reject) =>
        setTimeout(() => {
          if (document.hasFocus())
            reject(
              new Error(
                '로그인 팝업이 차단된 것 같아요 — 팝업 허용 후 다시 눌러주세요. 슬랙·카톡 안에서 열었다면 Safari나 Chrome으로 열어주세요',
              ),
            );
        }, 3000),
      ),
    ]);
    const found = [];
    let missed = 0;
    for (let i = 0; i < sel.length; i++) {
      exportMsg(`Apple Music에서 검색 중… ${i + 1}/${sel.length}`);
      try {
        const r = await music.api.music('/v1/catalog/{{storefrontId}}/search', {
          term: `${sel[i].artist} ${sel[i].title}`.trim(),
          types: 'songs',
          limit: 1,
        });
        const song = (r.data ?? r).results?.songs?.data?.[0];
        if (song) found.push(song.id);
        else missed++;
      } catch {
        missed++;
      }
    }
    if (!found.length) {
      exportMsg('Apple Music에서 곡을 찾지 못했어요', true);
      return;
    }
    exportMsg('플레이리스트를 만드는 중…');
    await music.api.music('/v1/me/library/playlists', {}, {
      fetchOptions: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attributes: { name, description: '합주 세트리스트에서 내보냄' },
          relationships: { tracks: { data: found.map((id) => ({ id, type: 'songs' })) } },
        }),
      },
    });
    exportMsg(
      `Apple Music 보관함에 "${esc(name)}"를 만들었어요 (${found.length}곡${missed ? `, ${missed}곡은 못 찾음` : ''})`,
    );
  } catch (err) {
    exportMsg(esc(err?.message || 'Apple Music 내보내기에 실패했어요'), true);
  } finally {
    $('#x-apple').disabled = false;
  }
});

// Spotify — 직접 생성은 개발 모드 5인 제한(2026.2 정책)이라 보류, 목록 복사 제공
$('#x-spotify').addEventListener('click', async () => {
  const sel = exportSelection();
  try {
    await navigator.clipboard.writeText(playlistText(sel));
    exportMsg(`${sel.length}곡을 복사했어요 — Spotify 플레이리스트 만들 때 붙여넣어 검색하면 돼요`);
  } catch {
    exportMsg('복사가 안 돼요 — 다시 시도해주세요', true);
  }
});

/* ── 시작 ── */
async function initData() {
  try {
    members = (await api('/api/members')).members || [];
  } catch {
    members = [];
  }
  renderGateProfiles();
  syncGate(); // 아바타 반영
  try {
    await load();
  } catch (err) {
    $('#songs').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}
syncGate();
if (accessCode) initData();
setInterval(() => {
  if (accessCode) poll().catch(() => {});
}, 15000); // 다른 멤버 변경사항 주기 반영
