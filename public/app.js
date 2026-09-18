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
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.1-7-11a7 7 0 0 1 14 0c0 5.9-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-8-8 18-2.5-7.5L3 11Z"/></svg>',
};

const expanded = new Set(); // 펼쳐진 곡 id — 재렌더에도 유지
let filter = 'all'; // 단일 상태 필터: all | open | start | growing | near | full | unset
let mineOnly = false; // '내 곡' 토글 — 상태 필터와 독립 조합
let query = '';
let roleFilter = '';
const statusOptions = [{id:'all',label:'전체'}, {id:'open',label:'모집중 전체'}, ...Discovery.stages];
const commentDrafts = new Map();
const draftKey = (id, user = me) => JSON.stringify([user, id]);
const pendingComments = new Set();
let dialogReturnY = 0;
let savingSong = false;
let songSort = localStorage.getItem('concert-sort') || 'latest';
let boardLayout = localStorage.getItem('concert-layout') !== 'list';

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
  renderSchedule(); // 일정 그리드의 '내 가능 시간' 표시도 me 의존
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

document.addEventListener('click', e => {
  document.querySelectorAll('.site-menu[open], .view-options[open]').forEach(menu => {
    if (!menu.contains(e.target) || e.target.closest('button')) menu.open = false;
  });
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  document.querySelectorAll('.site-menu[open], .view-options[open]').forEach(menu => {
    menu.open = false; $('summary', menu).focus();
  });
});

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
  if (savingSong) return;
  savingSong = true;
  const submit = $('#song-form button[type="submit"]');
  const msg = $('#song-save-status');
  submit.disabled = true;
  msg.hidden = false; msg.textContent = '추가 중…';
  const values = {
    title: $('#f-title').value, artist: $('#f-artist').value,
    link: $('#f-link').value, slots: stepperValues($('#f-slots')), nickname: me,
  };
  const controls = [...$('#composer').querySelectorAll('input, button')].filter(el => !el.disabled);
  controls.forEach(el => { el.disabled = true; });
  try {
    const song = await api('/api/songs', 'POST', values);
    $('#song-form').reset();
    clearMusicSelection();
    invalidateMusicSearch();
    $('#music-query').value = '';
    $('#music-status').textContent = '추가했어요. 다음 곡을 검색할 수 있어요.';
    $('#parse-msg').hidden = true;
    renderSteppers($('#f-slots'), { ...DEFAULT_SLOTS });
    setComposer(false);
    songs.push(song);
    render();
    const shown = matchesFilter(song);
    $('#workspace-status').hidden = false;
    $('#workspace-status').textContent = '‘' + song.title + '’ 추가했어요.' + (shown ? '' : ' 현재 필터에서 보이지 않아요.');
    if (!shown) $('#workspace-status').insertAdjacentHTML('beforeend', ' <button type="button" class="ghost" id="show-added-song">필터 해제하고 보기</button>');
    lastAddedSong = song.id;
    if (shown) revealAddedSong();
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    savingSong = false;
    controls.forEach(el => { el.disabled = false; });
    submit.disabled = false;
  }
});

let lastAddedSong = null;
function revealAddedSong() {
  const row = $('.song[data-id="' + lastAddedSong + '"] .row-head');
  if (row) { row.focus({preventScroll:true}); row.scrollIntoView({block:'center'}); }
}
$('#workspace-status').addEventListener('click', e => {
  if (!e.target.closest('#show-added-song')) return;
  filter = 'all'; roleFilter = ''; mineOnly = false; query = '';
  $('#role-filter').value = ''; $('#search').value = '';
  render(); e.target.remove(); revealAddedSong();
});

/* ── 곡 적기 접기/펼치기 ── */
$('#composer-toggle').insertAdjacentHTML('beforeend', ICONS.caret); // 캐럿 아이콘은 ICONS 단일 정의
function setComposer(open) {
  if (open && !savingSong) $('#song-save-status').hidden = true;
  $('#composer').classList.toggle('open', open);
  $('#composer-toggle').setAttribute('aria-expanded', open);
}
$('#composer-toggle').addEventListener('click', () => {
  const open = !$('#composer').classList.contains('open');
  setComposer(open);
  if (open) $('#music-query').focus();
});

/* ── 합주 일정 (when2meet식 가능 시간 히트맵 + 확정 합주일) ── */
$('#scheduler-toggle').insertAdjacentHTML('beforeend', ICONS.caret);

let schedule = null; // /api/schedule 응답
let schedCache = ''; // 마지막 렌더 HTML — 변경 없으면 DOM 교체 생략
let gigTopCache = ''; // 상단 히어로 영역(#gig-top)용 캐시
let painting = null; // 드래그 페인트 중: { on, pre:Set, slots:Set, r0, c0 } — null이면 페인트 아님

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const QUARTERS = [0, 15, 30, 45]; // when2meet과 같은 15분 단위 슬롯
let weekStart = null; // 주간 뷰(월~일)의 월요일 — 첫 렌더에서 다가오는 후보 날짜 기준으로 계산
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const mondayOf = (dateStr) =>
  addDays(dateStr, -((new Date(dateStr + 'T00:00:00').getDay() + 6) % 7));
const ddayOf = (dateStr) =>
  Math.round((new Date(dateStr + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 86400000);

// 클립보드 복사 + 버튼에 잠깐 완료 표시 (데이터 변화가 없어 재렌더에 지워지지 않는다)
async function copySwap(btn, text, done) {
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.innerHTML;
    btn.textContent = done;
    setTimeout(() => { btn.innerHTML = orig; }, 2500);
  } catch {
    alert('복사가 안 돼요 — 다시 시도해주세요');
  }
}

// 확정 합주 .ics 내려받기 — 로컬 시간(플로팅), iOS·구글 캘린더 임포트용
function downloadIcs(c) {
  const d = c.date.replace(/-/g, '');
  const pad = (n) => String(n).padStart(2, '0');
  const body = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//concert//KO',
    'BEGIN:VEVENT',
    `UID:${c.id}@concert`,
    `DTSTAMP:${d}T000000Z`,
    `DTSTART:${d}T${pad(c.start)}0000`,
    `DTEND:${d}T${pad(c.end)}0000`,
    `SUMMARY:밴드 합주${c.note ? ` · ${c.note}` : ''}`,
    c.note ? `LOCATION:${c.note}` : '',
    `URL:${location.origin}`,
    'END:VEVENT', 'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
  a.download = `합주-${c.date}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// 다가오는 합주 카드 (B+C) — 가장 가까운 확정 건만 카드, 나머지는 줄로
function gigCardHTML(c) {
  const n = dateLabel(c.date);
  const dd = ddayOf(c.date);
  const avail = c.avail || []; // 구버전 확정 건엔 스냅샷이 없다
  const pending = members.filter((m) => !avail.includes(m.name)).length;
  const stack = avail
    .map((nm) => avatarImg(nm, 'gh-ava') || `<i class="gh-init">${esc(nm.slice(0, 1))}</i>`)
    .join('');
  return `
    <div class="gig-hero ${dayCls(n.dow)}">
      <span class="gh-date">
        <b class="gh-md">${n.md}</b>
        <em>${n.day}요일</em>
        <span class="gh-dday">${dd === 0 ? '오늘' : `D-${dd}`}</span>
      </span>
      <span class="gh-sep" aria-hidden="true"></span>
      <span class="gh-info">
        <span class="gh-time">${c.start}:00–${c.end}:00</span>
        ${c.note ? `<span class="gh-note">${ICONS.pin}${esc(c.note)}</span>` : ''}
        ${avail.length ? `<span class="gh-who"><span class="gh-stack">${stack}</span><i class="gh-cnt">${avail.length}명 가능${pending && members.length ? ` · 미정 ${pending}` : ''}</i></span>` : ''}
      </span>
      <span class="gh-actions">
        <button type="button" data-act="sched-ics" data-id="${c.id}">${ICONS.cal}캘린더</button>
        <button type="button" data-act="sched-announce" data-id="${c.id}">${ICONS.send}공지 복사</button>
        <button type="button" class="icon-btn" data-act="sched-unconfirm" data-id="${c.id}" aria-label="확정 취소">✕</button>
      </span>
    </div>`;
}
const slotKey = (date, h, m) =>
  `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
function dateLabel(date) {
  const d = new Date(date + 'T00:00:00');
  return { md: `${d.getMonth() + 1}/${d.getDate()}`, day: DAY_NAMES[d.getDay()], dow: d.getDay() };
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const dayCls = (dow) => (dow === 0 ? 'sun' : dow === 6 ? 'sat' : '');
const hourOpts = (sel, from, to) => {
  let o = '';
  for (let h = from; h <= to; h++)
    o += `<option value="${h}"${h === sel ? ' selected' : ''}>${h}시</option>`;
  return o;
};

// 상단 히어로 영역 (아코디언 밖): 다가오는 확정 카드 + 나머지 확정 줄 + 응답 현황 보드
function gigTopHTML(upcoming) {
  const s = schedule;
  const names = Object.keys(s.availability);

  const hero = upcoming.length ? gigCardHTML(upcoming[0]) : '';
  const rest = upcoming
    .slice(1)
    .map((c) => {
      const n = dateLabel(c.date);
      return `
        <div class="gig ${dayCls(n.dow)}">
          <span class="gig-date">${n.md}<em>${n.day}</em></span>
          <span class="gig-time">${c.start}:00–${c.end}:00</span>
          ${c.note ? `<span class="gig-note">${esc(c.note)}</span>` : ''}
          <span class="leader" aria-hidden="true"></span>
          <button type="button" class="icon-btn" data-act="sched-unconfirm" data-id="${c.id}" aria-label="확정 취소">✕</button>
        </div>`;
    })
    .join('');

  // 응답 현황 보드 (B) — 멤버 프로필이 있어야 미응답을 알 수 있다
  let board = '';
  if (s.dates.length && members.length) {
    const known = members.map((m) => m.name);
    const missing = known.filter((nm) => !names.includes(nm));
    const totalN = known.length + names.filter((nm) => !known.includes(nm)).length;
    const dash = ((names.length / Math.max(1, totalN)) * 94.2).toFixed(1);
    const chip = (nm, miss) =>
      `<span class="sb-chip${miss ? ' miss' : ''}">${avatarImg(nm, 'sb-ava') || `<i class="sb-init">${esc(nm.slice(0, 1))}</i>`}${esc(nm)}</span>`;
    board = `
      <div class="sched-board">
        <svg class="sb-ring" width="38" height="38" viewBox="0 0 38 38" aria-hidden="true">
          <circle cx="19" cy="19" r="15" fill="none" stroke="var(--line)" stroke-width="3.5"></circle>
          <circle cx="19" cy="19" r="15" fill="none" stroke="var(--amber)" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${dash} 94.2" transform="rotate(-90 19 19)"></circle>
          <text x="19" y="23" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--ink)">${names.length}/${totalN}</text>
        </svg>
        <div class="sb-col">
          <span class="sb-label">가능 시간 응답 현황</span>
          <div class="sb-chips">${names.map((nm) => chip(nm, false)).join('')}${missing.map((nm) => chip(nm, true)).join('')}</div>
        </div>
        ${missing.length ? `<button type="button" class="sb-nudge" data-act="sched-remind">${ICONS.bell}미응답 ${missing.length}명 콕 찌르기</button>` : ''}
      </div>`;
  }

  return `${hero}${rest ? `<div class="gigs">${rest}</div>` : ''}${board}`;
}

function schedInnerHTML() {
  const s = schedule;
  const names = Object.keys(s.availability);
  const total = names.length;

  // 주간 뷰(노션 캘린더식): 열은 항상 월~일 7요일, 후보가 아닌 요일은 비활성 컬럼
  const today = todayStr();
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const confirmedByDate = Object.fromEntries(s.confirmed.map((c) => [c.date, c]));
  // 요일 헤더 — 미래 날짜는 전부 바로 칠 수 있으므로 조작은 ✕(그 날짜 조율 내리기)만, 내 그리드에만.
  // 확정된 날짜는 조작 없이 '확정' 마크 (후보에서 이미 빠져 있다)
  const heads = (ctrl) =>
    `<div class="sg-corner"></div>` +
    week
      .map((d) => {
        const n = dateLabel(d);
        if (confirmedByDate[d])
          return `<div class="sg-head done ${dayCls(n.dow)}${d === today ? ' today' : ''}"><em>${n.day}</em><span>${n.md}</span><small>확정</small></div>`;
        const cls = `${dayCls(n.dow)}${d === today ? ' today' : ''}${d < today ? ' off past' : ''}`;
        const act =
          ctrl && d >= today && s.dates.includes(d)
            ? `<button type="button" class="sg-del" data-act="sched-del-date" data-date="${d}" aria-label="${n.md} 조율 내리기">✕</button>`
            : '';
        return `<div class="sg-head ${cls}"><em>${n.day}</em><span>${n.md}</span>${act}</div>`;
      })
      .join('');
  // 15분 행 — 시간 라벨은 4행 스팬, 셀은 q0/q15/q30/q45로 시간선(실선)·30분선(점선) 구분
  const mineSet = new Set(s.availability[me] || []);
  const cells = (mode) => {
    let out = '';
    let r = 0;
    for (let h = s.startHour; h < s.endHour; h++) {
      out += `<div class="sg-hour" style="grid-row: span 4">${h}시</div>`;
      for (const m of QUARTERS) {
        out += week
          .map((d, c) => {
            const base = `q${m}${c === 0 ? ' c0' : ''}${r === 0 ? ' r0' : ''}`;
            const conf = confirmedByDate[d];
            // 칠 수 없는 컬럼은 확정된 날(확정 시간대만 은은한 앰버)과 지난 날뿐 — 미래 날짜는 바로 칠한다
            if (conf)
              return `<div class="sg-off conf ${base}"${h >= conf.start && h < conf.end ? ' style="background:rgba(255,180,84,0.08);"' : ''}></div>`;
            if (d < today) return `<div class="sg-off ${base}"></div>`;
            const key = slotKey(d, h, m);
            if (mode === 'mine') {
              const n = dateLabel(d);
              return `<button type="button" class="sgm-cell ${base}${mineSet.has(key) ? ' mine' : ''}"
                data-slot="${key}" data-r="${r}" data-c="${c}" aria-pressed="${mineSet.has(key)}"
                aria-label="${n.md} (${n.day}) ${h}:${String(m).padStart(2, '0')} 가능 토글"></button>`;
            }
            const who = names.filter((nm) => s.availability[nm].includes(key));
            const heat = total ? Math.round((who.length / total) * 72) : 0;
            return `<div class="sgg-cell ${base}" data-slot="${key}" style="--heat:${heat}%"></div>`;
          })
          .join('');
        r++;
      }
    }
    return out;
  };
  const legend = total
    ? `<span class="sg-legend">0/${total}${Array.from(
        { length: total + 1 },
        (_, k) => `<i style="--heat:${Math.round((k / total) * 72)}%"></i>`,
      ).join('')}${total}/${total}</span>`
    : '';
  const w0 = dateLabel(week[0]);
  const w6 = dateLabel(week[6]);
  const grid = `
    <div class="sg-nav">
      <b class="sg-week">${w0.md} ~ ${w6.md}</b>
      <span class="sg-nav-btns">
        <button type="button" data-act="sched-prev" aria-label="이전 주">‹</button>
        <button type="button" data-act="sched-today">오늘</button>
        <button type="button" data-act="sched-next" aria-label="다음 주">›</button>
      </span>
    </div>
    <div class="sg2">
      <div class="sg-pane">
        <div class="sg-pane-head"><span class="sg-title">내 가능 시간</span></div>
        <div class="sg-scroll"><div class="sgrid" style="--cols:7">${heads(true)}${cells('mine')}</div></div>
      </div>
      <div class="sg-pane">
        <div class="sg-pane-head"><span class="sg-title">모두의 가능 시간</span>${legend}</div>
        <div class="sg-scroll"><div class="sgrid sgg" style="--cols:7">${heads(false)}${cells('group')}</div></div>
      </div>
    </div>
    <p class="sched-hint">왼쪽 표의 아무 날짜나 누르거나 드래그해 <b>내 가능 시간</b>을 칠하세요 — 칠한 날짜는 후보로 자동 등록되고, 오른쪽에 모두의 시간이 모여요. 오른쪽 칸에 커서를 올리면(탭하면) 누가 되는지 보여요</p>
    ${total && !members.length ? `<p class="sched-who">응답 ${total}명 ·${names.map((nm) => ` ${avatarImg(nm)}${esc(nm)}`).join('')}</p>` : ''}`;

  const confirmForm = s.dates.length
    ? `
      <form class="sched-confirm" data-act="sched-confirm">
        <span class="sc-label">합주일 확정</span>
        <select name="date" aria-label="확정 날짜">${s.dates
          .map((d) => {
            const n = dateLabel(d);
            return `<option value="${d}">${n.md} (${n.day})</option>`;
          })
          .join('')}</select>
        <select name="start" aria-label="시작">${hourOpts(s.startHour, 0, 23)}</select>
        <span class="sc-tilde">~</span>
        <select name="end" aria-label="끝">${hourOpts(s.endHour, 1, 24)}</select>
        <input type="text" name="note" maxlength="80" placeholder="메모 (합주실 등)" autocomplete="off" />
        <button type="submit">확정</button>
      </form>`
    : '';

  return `
    <div class="sched-tools">
      <span class="sched-range" title="표에 보이는 시간 범위">
        <select id="sd-start" aria-label="시작 시간">${hourOpts(s.startHour, 0, 23)}</select>
        <span>~</span>
        <select id="sd-end" aria-label="끝 시간">${hourOpts(s.endHour, 1, 24)}</select>
      </span>
    </div>
    ${grid}
    ${confirmForm}`;
}

function renderSchedule() {
  if (!schedule || painting) return;
  const today = todayStr();
  // 첫 렌더: 다가오는 후보 → 다가오는 확정 합주 → 오늘 순으로 그 주를 보여준다
  if (!weekStart)
    weekStart = mondayOf(
      schedule.dates.find((d) => d >= today) ||
        schedule.confirmed.find((c) => c.date >= today)?.date ||
        today,
    );
  const upcoming = schedule.confirmed.filter((c) => c.date >= today);
  // 토글 칩: 확정 건은 상단 히어로가 항상 보여주므로 조율 상태만 요약
  const chip = $('#sched-chip');
  if (upcoming.length) {
    chip.hidden = true;
  } else if (schedule.dates.length) {
    const resp = Object.keys(schedule.availability).length;
    chip.hidden = false;
    chip.textContent = `후보 ${schedule.dates.length}일 조율 중${members.length ? ` · 응답 ${resp}/${Math.max(members.length, resp)}` : ''}`;
    chip.classList.remove('set');
  } else {
    chip.hidden = false;
    chip.textContent = '가능 시간을 칠해보세요';
    chip.classList.remove('set');
  }
  // 상단 히어로 영역 — 입력 요소가 없어 포커스 보존 없이 교체 가능
  const nextGig = upcoming[0];
  $('#gig-summary-label').textContent = nextGig
    ? '다음 합주 · ' + dateLabel(nextGig.date).md + ' ' + nextGig.start + ':00–' + nextGig.end + ':00 · 상세'
    : schedule.dates.length ? '합주 일정 · ' + schedule.dates.length + '일 조율 중 · 상세' : '합주 일정 · 확정된 일정 없음';
  const top = gigTopHTML(upcoming);
  if (top !== gigTopCache) {
    gigTopCache = top;
    $('#gig-top').innerHTML = top;
  }
  const html = schedInnerHTML();
  if (html === schedCache) return;
  // 날짜·메모 입력 중이면 이번 갱신은 건너뛴다 — 다음 폴링에 자연 반영
  const act = document.activeElement;
  if (act?.closest?.('#sched-inner') && act.matches('input')) return;
  schedCache = html;
  $('#sched-inner').innerHTML = html;
}

async function loadSchedule() {
  schedule = await api('/api/schedule');
  renderSchedule();
}
async function pollSchedule() {
  const next = await api('/api/schedule');
  if (JSON.stringify(next) === JSON.stringify(schedule)) return;
  schedule = next;
  renderSchedule();
}

const schedEl = $('#scheduler');

// 사각형 페인트 (when2meet 방식): 시작 칸~현재 칸의 직사각형을 시작 칸의 반대 상태로 통일.
// 매 이동마다 페인트 전 스냅샷(pre)에서 다시 계산하므로, 드래그를 되돌리면 벗어난 칸은 원상복구된다.
function paintRect(r1, c1) {
  const p = painting;
  const rLo = Math.min(p.r0, r1);
  const rHi = Math.max(p.r0, r1);
  const cLo = Math.min(p.c0, c1);
  const cHi = Math.max(p.c0, c1);
  p.slots = new Set(p.pre);
  document.querySelectorAll('#sched-inner .sgm-cell').forEach((cell) => {
    const key = cell.dataset.slot;
    const inRect =
      +cell.dataset.r >= rLo && +cell.dataset.r <= rHi && +cell.dataset.c >= cLo && +cell.dataset.c <= cHi;
    const on = inRect ? p.on : p.pre.has(key);
    if (inRect && p.on) p.slots.add(key);
    else if (inRect) p.slots.delete(key);
    cell.classList.toggle('mine', on);
    cell.setAttribute('aria-pressed', on);
  });
}
async function putAvailability(slots) {
  const focused = document.activeElement?.dataset?.slot; // 키보드 토글 시 재렌더 후 포커스 복원
  schedule = await api('/api/schedule/availability', 'PUT', { name: me, slots });
  schedCache = ''; // 로컬로 바꾼 칸들 → 서버 상태로 전면 재렌더
  renderSchedule();
  if (focused) $(`.sgm-cell[data-slot="${focused}"]`)?.focus();
}
schedEl.addEventListener('pointerdown', (e) => {
  const cell = e.target.closest('.sgm-cell');
  if (!cell || !me) {
    // 칠 수 없는 칸(비활성·확정 컬럼)을 눌렀을 때 — 조용히 무시하면 "드래그 고장"으로 보인다
    const off = me && e.target.closest('.sgrid:not(.sgg) .sg-off');
    if (off)
      flashHint(
        e.clientX,
        e.clientY,
        off.classList.contains('conf')
          ? '이미 확정된 날이에요 — 새 조율은 다른 날짜에 칠해주세요'
          : '지난 날짜는 칠 수 없어요',
      );
    return;
  }
  e.preventDefault(); // 드래그 중 텍스트 선택 방지
  const pre = new Set(schedule.availability[me] || []);
  painting = {
    on: !cell.classList.contains('mine'),
    pre,
    slots: new Set(pre),
    r0: +cell.dataset.r,
    c0: +cell.dataset.c,
  };
  paintRect(painting.r0, painting.c0);
});
schedEl.addEventListener('pointermove', (e) => {
  if (!painting) return;
  const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.sgm-cell');
  if (cell) paintRect(+cell.dataset.r, +cell.dataset.c);
});
async function commitPaint() {
  if (!painting) return;
  const slots = [...painting.slots];
  painting = null;
  try {
    await putAvailability(slots);
  } catch (err) {
    if (!accessCode) return;
    alert(err.message);
    loadSchedule().catch(() => {});
  }
}
window.addEventListener('pointerup', commitPaint);
window.addEventListener('pointercancel', commitPaint);

/* 그룹 그리드 hover/탭 → 가능·불가 명단 팝업 (when2meet의 mouseover 패널, 커서 추종) */
const popEl = $('#sg-pop');
let popKey = null; // 같은 칸 위 이동 중엔 위치만 갱신
function showPop(key, x, y) {
  if (popKey !== key) {
    popKey = key;
    const names = Object.keys(schedule.availability);
    const avail = names.filter((nm) => schedule.availability[nm].includes(key));
    const unavail = names.filter((nm) => !avail.includes(nm));
    const n = dateLabel(key.slice(0, 10));
    const h = Number(key.slice(11, 13));
    const m = Number(key.slice(14, 16));
    const list = (arr) =>
      arr.map((nm) => `<span class="nm">${avatarImg(nm)}${esc(nm)}</span>`).join('') ||
      '<span class="nm none">—</span>';
    popEl.innerHTML = `
      <b>${n.md} (${n.day}) ${h}:${String(m).padStart(2, '0')}–${m === 45 ? h + 1 : h}:${String((m + 15) % 60).padStart(2, '0')}</b>
      <div class="sg-pop-cols">
        <div><em>가능 ${avail.length}</em>${list(avail)}</div>
        <div><em>불가 ${unavail.length}</em>${list(unavail)}</div>
      </div>`;
  }
  placePop(x, y);
}
function placePop(x, y) {
  popEl.hidden = false;
  const w = popEl.offsetWidth;
  const ph = popEl.offsetHeight;
  popEl.style.left = `${Math.min(x + 14, innerWidth - w - 8)}px`;
  popEl.style.top = `${y + 18 + ph > innerHeight ? y - ph - 12 : y + 18}px`;
}
let popHold = 0; // 안내 팝업이 mousemove·click의 hidePop에 바로 지워지지 않게 잠깐 고정
function hidePop(force) {
  if (!force && Date.now() < popHold) return;
  popEl.hidden = true;
  popKey = null;
}
// 칠 수 없는 칸을 눌렀을 때의 안내 — 이름 팝업과 같은 말풍선을 잠깐 띄운다
function flashHint(x, y, text) {
  popKey = null;
  popEl.innerHTML = `<b>${esc(text)}</b>`;
  placePop(x, y);
  popHold = Date.now() + 1800;
  setTimeout(() => {
    if (popKey === null && Date.now() >= popHold) hidePop(true);
  }, 1900);
}
schedEl.addEventListener('mousemove', (e) => {
  const cell = e.target.closest('.sgg-cell');
  if (cell) showPop(cell.dataset.slot, e.clientX, e.clientY);
  else hidePop();
});
schedEl.addEventListener('mouseleave', () => hidePop());
// 터치: 그룹 칸 탭으로 열고, 그 밖을 탭하면 닫는다 (데스크톱 클릭도 같은 경로라 무해)
document.addEventListener('click', (e) => {
  const cell = e.target.closest('.sgg-cell');
  if (cell) showPop(cell.dataset.slot, e.clientX, e.clientY);
  else hidePop();
});

// 일정 액션 위임 — 그리드는 #scheduler 안, 히어로·보드 버튼은 #gig-top 안에 있어 둘 다 바인딩
const onSchedClick = async (e) => {
  if (e.target.closest('#scheduler-toggle')) {
    const open = !schedEl.classList.contains('open');
    schedEl.classList.toggle('open', open);
    $('#scheduler-toggle').setAttribute('aria-expanded', open);
    return;
  }
  // 키보드(Enter/Space)로 칸 토글 — 포인터 페인트의 접근성 폴백 (마우스 클릭은 detail>0이라 중복 안 됨)
  const cell = e.target.closest('.sgm-cell');
  if (cell && e.detail === 0 && me) {
    const slots = new Set(schedule.availability[me] || []);
    if (!slots.delete(cell.dataset.slot)) slots.add(cell.dataset.slot);
    try {
      await putAvailability([...slots]);
    } catch (err) {
      if (accessCode) alert(err.message);
    }
    return;
  }
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  try {
    switch (btn.dataset.act) {
      case 'sched-prev':
        weekStart = addDays(weekStart, -7);
        renderSchedule();
        break;
      case 'sched-next':
        weekStart = addDays(weekStart, 7);
        renderSchedule();
        break;
      case 'sched-today':
        weekStart = mondayOf(todayStr());
        renderSchedule();
        break;
      case 'sched-del-date': {
        const n = dateLabel(btn.dataset.date);
        if (!confirm(`${n.md} (${n.day}) 후보를 지울까요? 다들 칠해둔 가능 시간도 함께 지워져요`)) return;
        schedule = await api('/api/schedule/dates', 'DELETE', { date: btn.dataset.date });
        renderSchedule();
        break;
      }
      case 'sched-unconfirm':
        if (!confirm('이 합주일 확정을 취소할까요? (조율이 다시 필요하면 날짜를 새로 올려주세요)')) return;
        schedule = await api(`/api/schedule/confirmed/${btn.dataset.id}`, 'DELETE');
        renderSchedule();
        break;
      case 'sched-remind': {
        const done = Object.keys(schedule.availability);
        const missing = members.map((m) => m.name).filter((nm) => !done.includes(nm));
        copySwap(
          btn,
          `${missing.join(', ')} — 다음 합주 가능 시간을 아직 안 칠하셨어요! ${location.origin}`,
          '복사됨! #yb에 붙여넣어주세요',
        );
        return;
      }
      case 'sched-ics': {
        const c = schedule.confirmed.find((x) => x.id === btn.dataset.id);
        if (c) downloadIcs(c);
        return;
      }
      case 'sched-announce': {
        const c = schedule.confirmed.find((x) => x.id === btn.dataset.id);
        if (!c) return;
        const n = dateLabel(c.date);
        copySwap(
          btn,
          `${n.md} (${n.day}) ${c.start}:00–${c.end}:00 합주 확정!${c.note ? ` · ${c.note}` : ''} ${location.origin}`,
          '복사됨!',
        );
        return;
      }
    }
  } catch (err) {
    if (!accessCode) return;
    alert(err.message);
    loadSchedule().catch(() => {});
  }
};
schedEl.addEventListener('click', onSchedClick);
$('#gig-top').addEventListener('click', onSchedClick);

// 시간 범위 변경 — 뒤집힌 범위는 끝을 한 시간 뒤로 밀어 살린다
schedEl.addEventListener('change', async (e) => {
  if (e.target.id !== 'sd-start' && e.target.id !== 'sd-end') return;
  const startHour = Number($('#sd-start').value);
  const endHour = Math.max(Number($('#sd-end').value), startHour + 1);
  try {
    schedule = await api('/api/schedule', 'PATCH', { startHour, endHour });
    renderSchedule();
  } catch (err) {
    if (!accessCode) return;
    alert(err.message);
    loadSchedule().catch(() => {});
  }
});

schedEl.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-act="sched-confirm"]');
  if (!form) return;
  e.preventDefault();
  const f = new FormData(form);
  const start = Number(f.get('start'));
  const end = Math.max(Number(f.get('end')), start + 1);
  try {
    schedule = await api('/api/schedule/confirmed', 'POST', {
      date: f.get('date'),
      start,
      end,
      note: f.get('note'),
      nickname: me,
    });
    renderSchedule();
  } catch (err) {
    if (!accessCode) return;
    alert(err.message);
  }
});

/* ── 필터·검색 ── */
$('#filters').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter');
  if (!btn) return;
  mineOnly = !mineOnly;
  render();
});
$('#search').addEventListener('input', (e) => {
  query = e.target.value.trim().toLowerCase();
  render();
});

/* ── 곡 리스트 ── */
function remainInfo(song) {
  const state = Discovery.state(song);
  if (state.id === 'unset') return { cls: 'none', text: '정원 미설정' };
  if (state.id === 'full') return { cls: 'full', text: '모집 완료' };
  return { cls: state.id === 'near' ? 'some' : 'many', text: state.left + '자리 남음' };
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
  const state = Discovery.state(song);
  if (name === 'open') return state.cap > 0 && state.left > 0;
  return name === 'all' || state.id === name;
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
  const minis = activeSessions(song).filter(s => song.slots[s] > song.members[s].length)
    .map(s => '<span class="vacancy">' + SESSION_META[s].label + ' ' + (song.slots[s] - song.members[s].length) + '</span>').join('');
  const cmt = song.comments.length
    ? `<span class="mini cmt" title="코멘트 ${song.comments.length}개">${ICONS.comment}<span class="mini-num">${song.comments.length}</span></span>`
    : '';

  // 썸네일: 유튜브 링크는 공식 썸네일 CDN(추가 API 불필요), 그 외엔 피크 플레이스홀더
  const vid = youtubeId(song.link);
  const no = String(idx + 1).padStart(2, '0');
  const thumb = vid
    ? `<span class="thumb"><span class="no">${no}</span><img src="https://i.ytimg.com/vi/${vid}/mqdefault.jpg" alt="" loading="lazy" decoding="async" /></span>`
    : `<span class="thumb no-thumb"><span class="no">${no}</span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 22C8.5 18.5 3 14.5 3 9.2 3 5.2 7 2.5 12 2.5s9 2.7 9 6.7c0 5.3-5.5 9.3-9 12.8Z" fill="currentColor"/></svg></span>`;

  return `
    <article class="song ${open ? 'open' : ''}" data-id="${song.id}">
      <button type="button" class="row-head" data-act="toggle" aria-expanded="${open}">
        <span class="song-number">${no}</span>
        <span class="col">
          <strong>${esc(song.title)}</strong>
          ${song.artist ? `<em>${esc(song.artist)}</em>` : ''}
          <span class="row-mini">${minis}${cmt}</span>
        </span>
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
          ${vid ? `<div class="player" data-video="${vid}">${open ? playerHTML(vid) : ''}</div>` : ''}
          <div class="song-body">
            <div class="sessions">${stageHTML(song)}</div>
            <div class="comments">
              ${comments}
              <form class="comment-form" data-act="comment">
                <input type="text" maxlength="200" placeholder="하고 싶은 말" aria-label="댓글" autocomplete="off" />
                <button type="submit">남기기</button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </article>`;
}

function matchesFilter(song, state = filter, mine = mineOnly) {
  if (roleFilter && song.slots[roleFilter] <= song.members[roleFilter].length) return false;
  if (!inCategory(song, state)) return false;
  if (mine && !isMine(song)) return false;
  if (query) {
    const haystack =
      `${song.title} ${song.artist} ${SESSIONS.flatMap((s) => song.members[s]).join(' ')}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

// 칩 카운트·활성 표시는 렌더마다 파생 — 숫자는 "그 칩을 눌렀을 때 보게 될 곡 수"
function filterCounts() {
  const mine = $('#filters .mine');
  $('.cnt', mine).textContent = songs.filter(s => matchesFilter(s, filter, true)).length;
  mine.classList.toggle('on', mineOnly);
  mine.setAttribute('aria-pressed', mineOnly);
  $('#state-filter').innerHTML = statusOptions.map(st => '<option value="' + st.id + '">' + esc(st.label) + ' · ' + songs.filter(s => matchesFilter(s, st.id)).length + '</option>').join('');
  $('#state-filter').value = filter;
  const active = [];
  if (filter !== 'all') active.push(['state', statusOptions.find(s => s.id === filter).label]);
  if (roleFilter) active.push(['role', SESSION_META[roleFilter].label + ' 빈자리']);
  if (mineOnly) active.push(['mine', '내 참여']);
  if (query) active.push(['query', '검색: ' + query]);
  $('#active-filters').hidden = !active.length;
  $('#active-filters').innerHTML = active.map(([key,label]) => '<button type="button" data-clear="' + key + '" aria-label="' + esc(label) + ' 해제">' + esc(label) + ' ×</button>').join('');
}

// keyed diff 렌더 — 바뀐 카드만 DOM 교체 (이미지 재로드·애니메이션 재생 방지)
const cardCache = new Map(); // song.id -> 마지막 렌더 HTML

function render() {
  const container = $('#songs');
  const focused = document.activeElement;
  const editingComment = focused?.matches('.comment-form input') ? {id:focused.closest('.song').dataset.id, start:focused.selectionStart, end:focused.selectionEnd} : null;
  for (const id of [...expanded]) if (!songs.some(s => s.id === id)) {
    expanded.delete(id); $('#song-dialog').close();
  }
  const visible = songs.map((s, i) => ({s, i})).filter(({s}) => matchesFilter(s)).sort((a, b) =>
    songSort === 'latest' ? Date.parse(b.s.createdAt) - Date.parse(a.s.createdAt) :
    (a.s[songSort] || '').localeCompare(b.s[songSort] || '', 'ko'));
  filterCounts();
  $('#song-count').textContent = '— ' + visible.length + '/' + songs.length + '곡';
  container.classList.toggle('board-layout', boardLayout);
  $('#layout-toggle').textContent = boardLayout ? '목록 보기' : '보드 보기';
  $('#song-sort').value = songSort;

  if (!container.querySelector('.song-group')) {
    container.innerHTML = Discovery.stages.map(st => '<section class="song-group stage-' + st.id + '" data-group="' + st.id + '"><h3><i class="status-dot"></i>' + esc(st.label) + ' <span class="group-count"></span><small>' + esc(st.hint) + '</small></h3><div class="group-items"></div></section>').join('') +
      '<div class="empty" hidden><span class="empty-message">조건에 맞는 곡이 없어요</span><br><button type="button" class="ghost" id="clear-filter">필터 초기화</button></div>';
  }
  const seen = new Set(), anchors = new Map();
  for (const {s, i} of visible) {
    seen.add(s.id);
    const html = songCard(s, i);
    let el = $('#song-workspace').querySelector('.song[data-id="' + s.id + '"]');
    if (!el || cardCache.get(s.id) !== html) {
      const tpl = document.createElement('template'); tpl.innerHTML = html;
      const fresh = tpl.content.firstElementChild;
      if (el) el.replaceWith(fresh);
      el = fresh;
    }
    cardCache.set(s.id, html);
    const commentInput = $('.comment-form input', el);
    if (commentInput) commentInput.value = commentDrafts.get(draftKey(s.id)) || '';
    $('.comment-form button', el).disabled = pendingComments.has(draftKey(s.id));
    if (expanded.has(s.id) && $('#song-dialog').open) {
      if (el.parentElement !== $('#song-dialog-body')) $('#song-dialog-body').append(el);
      continue;
    }
    const group = Discovery.state(s).id;
    const parent = container.querySelector('[data-group="' + group + '"] .group-items');
    const anchor = anchors.get(group);
    if (anchor) { if (anchor.nextElementSibling !== el) anchor.after(el); }
    else if (parent.firstElementChild !== el) parent.prepend(el);
    anchors.set(group, el);
  }
  for (const el of [...$('#song-workspace').querySelectorAll('.song')]) if (!seen.has(el.dataset.id)) {
    if (expanded.has(el.dataset.id)) { expanded.delete(el.dataset.id); $('#song-dialog').close(); }
    cardCache.delete(el.dataset.id); el.remove();
  }
  for (const st of Discovery.stages) {
    const group = container.querySelector('[data-group="' + st.id + '"]');
    const count = visible.filter(({s}) => Discovery.state(s).id === st.id).length;
    group.hidden = !count;
    $('.group-count', group).textContent = count;
  }
  $('.empty', container).hidden = !!visible.length;
  $('.empty-message', container).textContent = songs.length ? '조건에 맞는 곡이 없어요' : '아직 등록된 곡이 없어요';
  if (editingComment) {
    const input = $('.song[data-id="' + editingComment.id + '"] .comment-form input');
    if (input && input !== document.activeElement) {
      input.focus({preventScroll:true}); input.setSelectionRange(editingComment.start, editingComment.end);
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
$('#song-workspace').addEventListener('click', async (e) => {
  if (e.target.closest('#clear-filter')) {
    filter = 'all';
    roleFilter = ''; $('#role-filter').value = '';
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
        if (willOpen) {
          dialogReturnY = window.scrollY;
          $('#song-dialog-title').textContent = song.title;
          $('#song-dialog-body').append(card);
          $('#song-dialog').showModal();
          $('#song-dialog-title').focus({preventScroll:true});
          $('.song-dialog-panel').scrollTop = 0;
        } else $('#song-dialog').close();
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

$('#song-workspace').addEventListener('input', e => {
  if (!e.target.matches('.comment-form input')) return;
  const key = draftKey(e.target.closest('.song').dataset.id);
  if (e.target.value) commentDrafts.set(key, e.target.value);
  else commentDrafts.delete(key);
});

$('#active-filters').addEventListener('click', e => {
  const key = e.target.closest('[data-clear]')?.dataset.clear;
  if (!key) return;
  if (key === 'state') filter = 'all';
  if (key === 'role') { roleFilter = ''; $('#role-filter').value = ''; }
  if (key === 'mine') mineOnly = false;
  if (key === 'query') { query = ''; $('#search').value = ''; }
  render();
  $('#search').focus({preventScroll:true});
});

$('#song-workspace').addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-act="comment"]');
  if (!form) return;
  e.preventDefault();
  const input = $('input', form);
  if (!input.value.trim()) return;
  const id = form.closest('.song').dataset.id;
  const key = draftKey(id), text = input.value, author = me;
  if (pendingComments.has(key)) return;
  pendingComments.add(key);
  $('button', form).disabled = true;
  try {
    const song = await api(`/api/songs/${id}/comments`, 'POST', { author, text });
    if (commentDrafts.get(key) === text) commentDrafts.delete(key);
    updateCard(song);
  } catch (err) {
    if (!accessCode) return;
    alert(err.message);
  } finally {
    pendingComments.delete(key);
    const button = $('.song[data-id="' + id + '"] .comment-form button');
    if (button) button.disabled = false;
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
const FILTER_LABEL = Object.fromEntries(statusOptions.filter(s => s.id !== 'all').map(s => [s.id,s.label]));
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
      .filter(s => matchesFilter(s)) // 현재 필터·검색이 그대로 추출 범위
      .sort((a, b) =>
        Discovery.stages.findIndex(st => st.id === Discovery.state(a).id) - Discovery.stages.findIndex(st => st.id === Discovery.state(b).id) ||
        (songSort === 'latest' ? Date.parse(b.createdAt) - Date.parse(a.createdAt) : (a[songSort] || '').localeCompare(b[songSort] || '', 'ko')))
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

/* ── 탐색 · 외부 곡 검색 ── */
$('#btn-add-song').addEventListener('click', () => {
  setComposer(true);
  $('#composer').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#music-query').focus();
});
$('#role-filter').addEventListener('change', e => { roleFilter = e.target.value; render(); });
$('#song-sort').addEventListener('change', e => {
  songSort = e.target.value; localStorage.setItem('concert-sort', songSort); render();
});
$('#layout-toggle').addEventListener('click', () => {
  boardLayout = !boardLayout; localStorage.setItem('concert-layout', boardLayout ? 'board' : 'list'); render();
});
$('#state-filter').addEventListener('change', e => { filter = e.target.value; render(); });
$('#song-dialog-close').addEventListener('click', () => $('#song-dialog').close());
const songDialog = $('#song-dialog');
songDialog.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const targets = [...songDialog.querySelectorAll('button,input,select,textarea,a[href],iframe,[tabindex]')]
    .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (!targets.length) return;
  event.preventDefault();
  const index = targets.indexOf(document.activeElement);
  const next = index < 0 ? (event.shiftKey ? targets.length - 1 : 0)
    : (index + (event.shiftKey ? -1 : 1) + targets.length) % targets.length;
  targets[next].focus();
});
let cardBackdropPressed = false;
songDialog.addEventListener('pointerdown', event => { cardBackdropPressed = event.target === songDialog; });
songDialog.addEventListener('pointercancel', () => { cardBackdropPressed = false; });
songDialog.addEventListener('click', event => {
  const dismiss = cardBackdropPressed && event.target === songDialog;
  cardBackdropPressed = false;
  if (dismiss) songDialog.close();
});
$('#song-dialog').addEventListener('close', () => {
  cardBackdropPressed = false;
  const id = [...expanded][0];
  expanded.clear();
  render();
  if (id) $('.song[data-id="' + id + '"] .row-head')?.focus({ preventScroll: true });
  window.scrollTo({top:dialogReturnY, behavior:'instant'});
});
let musicProvider = 'youtube', musicResults = [], musicRequest = 0;
function clearMusicSelection() {
  $('#music-search-pane').hidden = false;
  $('#music-selection').hidden = true;
}
$('#change-song').addEventListener('click', () => {
  clearMusicSelection();
  $('#music-query').focus({preventScroll:true});
});
function invalidateMusicSearch() {
  musicRequest++;
  musicResults = [];
  $('#music-results').replaceChildren();
}
async function loadMusicLabels(provider, q, sequence) {
  const pendingText = ' 버전 확인 중…';
  const finish = message => {
    if (sequence === musicRequest && accessCode)
      $('#music-status').textContent = $('#music-status').textContent.replace(pendingText, '') + ' ' + message;
  };
  $('#music-status').textContent += pendingText;
  try {
    const data = await api('/api/music-labels?' + new URLSearchParams({ provider, q }));
    if (sequence !== musicRequest || !accessCode) return;
    const labels = new Map(data.results.map(r => [r.id, r]));
    const names = { live: '라이브', cover: '커버', tutorial: '강좌' };
    let badgeCount = 0;
    musicResults.forEach((r, i) => {
      const target = $('#music-results [data-labels="' + i + '"]');
      if (!target) return;
      target.replaceChildren(...(labels.get(r.id)?.badges || []).filter(b => names[b]).map(b => {
        const badge = document.createElement('span');
        badgeCount++;
        badge.className = 'music-badge'; badge.textContent = names[b];
        badge.title = '제목·아티스트 정보를 바탕으로 한 자동 분류예요.';
        return badge;
      }));
    });
    if (data.results.some(r => r.unavailable)) finish('일부 버전 표시는 사용할 수 없어요. 곡 선택은 가능해요.');
    else finish(badgeCount ? '버전 확인 완료.' : '버전 확인 완료 · 표시할 버전 정보가 없어요.');
  } catch {
    finish('버전 표시는 잠시 사용할 수 없어요. 곡 선택은 가능해요.');
  }
}
$('#music-providers').addEventListener('click', e => {
  const btn = e.target.closest('[data-provider]');
  if (!btn) return;
  musicProvider = btn.dataset.provider;
  document.querySelectorAll('[data-provider]').forEach(b => {
    b.classList.toggle('on', b === btn); b.setAttribute('aria-pressed', b === btn);
  });
  invalidateMusicSearch();
  $('#music-status').textContent = '검색어를 입력하고 검색을 눌러주세요.';
  if ($('#music-query').value.trim()) $('#music-search-form').requestSubmit();
});
$('#music-query').addEventListener('input', () => {
  invalidateMusicSearch(); $('#music-status').textContent = '검색을 눌러 결과를 확인하세요.';
});
$('#music-search-form').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#music-query').value.trim();
  if (!q) return;
  const sequence = ++musicRequest;
  const provider = musicProvider;
  musicResults = [];
  $('#music-results').replaceChildren();
  $('#music-status').textContent = '검색 중…';
  try {
    const data = await api('/api/music-search?' + new URLSearchParams({ provider, q }));
    if (sequence !== musicRequest || !accessCode) return;
    musicResults = data.results;
    $('#music-status').textContent = musicResults.length ? musicResults.length + '개 결과 · 곡을 선택한 뒤 파트 정원을 확인해주세요.' : '검색 결과가 없어요. 다른 검색어로 찾아보세요.';
    $('#music-results').innerHTML = musicResults.map((r, i) => {
      const duplicate = songs.some(s => Discovery.linkKey(s.link) === Discovery.linkKey(r.url));
      return '<div class="music-result">' + (r.artwork ? '<img src="' + esc(r.artwork) + '" alt="" loading="lazy">' : '') +
        '<div><strong>' + esc(r.title) + '</strong><small>' + esc(r.artist) + ' · ' + esc(r.duration) + '</small><div class="music-badges" data-labels="' + i + '"></div></div>' +
        '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">듣기</a><button type="button" data-pick="' + i + '" ' + (duplicate ? 'disabled' : '') + '>' + (duplicate ? '등록됨' : '선택') + '</button></div>';
    }).join('');
    if (musicResults.length) void loadMusicLabels(provider, q, sequence);
  } catch (err) {
    if (sequence === musicRequest && accessCode) $('#music-status').textContent = err.message;
  }
});
$('#music-results').addEventListener('click', e => {
  const btn = e.target.closest('[data-pick]');
  if (!btn || btn.disabled) return;
  const result = musicResults[Number(btn.dataset.pick)];
  $('#f-title').value = result.title;
  $('#f-artist').value = musicProvider === 'youtube' ? '' : result.artist;
  $('#f-link').value = result.url;
  $('#parse-msg').hidden = false;
  $('#parse-msg').classList.remove('err');
  $('#parse-msg').textContent = musicProvider === 'youtube'
    ? 'YouTube 채널명은 뮤지션과 다를 수 있어요. 뮤지션·곡명과 파트 정원을 확인해주세요.'
    : '곡명·뮤지션과 파트 정원을 확인해주세요.';
  $('#selected-song').textContent = result.title + ' · ' + result.artist + ' · ' + ({youtube:'YouTube',apple:'Apple Music',spotify:'Spotify'}[musicProvider]);
  $('#music-search-pane').hidden = true;
  $('#music-selection').hidden = false;
  $('#selected-song').focus({preventScroll:true});
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
  loadSchedule().catch(() => {}); // 일정은 곡 리스트와 독립 — 실패해도 곡은 뜬다
  try {
    await load();
  } catch (err) {
    $('#songs').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}
syncGate();
if (accessCode) initData();
setInterval(() => {
  if (!accessCode) return;
  poll().catch(() => {});
  pollSchedule().catch(() => {});
}, 15000); // 다른 멤버 변경사항 주기 반영
