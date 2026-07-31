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
};

const expanded = new Set(); // 펼쳐진 곡 id — 재렌더에도 유지
let filter = 'all';
let query = '';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );

let accessCode = localStorage.getItem('accesscode') || '';

async function api(path, method = 'GET', body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (accessCode) headers['x-access-code'] = accessCode;
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/auth') {
    // 코드가 틀렸거나 서버에서 바뀜 → 인증 단계로 복귀
    accessCode = '';
    localStorage.removeItem('accesscode');
    syncGate();
  }
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
});
// 인증 정보 초기화 — 저장된 인증코드를 지우고 티켓 단계로 복귀
$('#btn-reset-auth').addEventListener('click', () => {
  accessCode = '';
  localStorage.removeItem('accesscode');
  $('#auth-code').value = '';
  $('#auth-msg').hidden = true;
  syncGate();
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
    await load();
  } catch (err) {
    alert(err.message);
  }
});

/* ── 곡 적기 접기/펼치기 ── */
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
  filter = btn.dataset.filter;
  document.querySelectorAll('.filter').forEach((b) => b.classList.toggle('on', b === btn));
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

function songCard(song, idx) {
  const remain = remainInfo(song);
  const rows = SESSIONS.filter((s) => song.slots[s] > 0 || song.members[s].length > 0)
    .map((s) => {
      const m = SESSION_META[s];
      const cap = song.slots[s];
      const cnt = song.members[s].length;
      const countCls = cnt > cap ? 'over' : cnt === cap && cap > 0 ? 'filled' : '';
      const chips = song.members[s]
        .map(
          (name) => `
            <span class="chip ${name === me ? 'me' : ''}">${avatarImg(name)}${esc(name)}
              <button type="button" data-act="leave" data-session="${s}" data-name="${esc(name)}" aria-label="${esc(name)} 빼기">✕</button>
            </span>`,
        )
        .join('');
      const joined = song.members[s].includes(me);
      return `
        <div class="session-row">
          <span class="tag ${s}" title="${m.label}">${m.tag}</span>
          <span class="count ${countCls}">${cnt}/${cap}</span>
          <div class="chips">${chips}
            ${joined ? '' : `<button type="button" class="join" data-act="join" data-session="${s}">+ 하고싶어요</button>`}
          </div>
        </div>`;
    })
    .join('');

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
  const minis = SESSIONS.filter((s) => song.slots[s] > 0 || song.members[s].length > 0)
    .map((s) => {
      const cap = song.slots[s];
      const cnt = song.members[s].length;
      const cls = cnt > cap ? 'over' : cnt === cap && cap > 0 ? 'filled' : '';
      const label = `${SESSION_META[s].label} ${cnt}/${cap}`;
      return `<span class="mini ${cls}" title="${label}" aria-label="${label}"><i class="dot ${s}"></i><span class="mini-num ${cls}">${cnt}/${cap}</span></span>`;
    })
    .join('');
  const cmt = song.comments.length
    ? `<span class="mini cmt" title="코멘트 ${song.comments.length}개"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H4l2.5-2.7A8 8 0 1 1 21 12Z"/></svg><span class="mini-num">${song.comments.length}</span></span>`
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
          <div class="song-body">
            <div class="sessions">${rows || '<p class="count">세션 정원이 아직 없어요 — 수정 버튼으로 채워주세요</p>'}</div>
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
  const remain = remainInfo(song);
  if (filter === 'open' && !(remain.cls === 'some' || remain.cls === 'many')) return false;
  if (filter === 'full' && remain.cls !== 'full') return false;
  if (filter === 'mine' && !SESSIONS.some((s) => song.members[s].includes(me))) return false;
  if (query) {
    const haystack =
      `${song.title} ${song.artist} ${SESSIONS.flatMap((s) => song.members[s]).join(' ')}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

function filterCounts() {
  const counts = { all: songs.length, open: 0, full: 0, mine: 0 };
  for (const s of songs) {
    const cls = remainInfo(s).cls;
    if (cls === 'some' || cls === 'many') counts.open++;
    if (cls === 'full') counts.full++;
    if (SESSIONS.some((sess) => s.members[sess].includes(me))) counts.mine++;
  }
  document.querySelectorAll('.filter').forEach((b) => {
    $('.cnt', b).textContent = counts[b.dataset.filter];
  });
}

// keyed diff 렌더 — 바뀐 카드만 DOM 교체 (이미지 재로드·애니메이션 재생 방지)
const cardCache = new Map(); // song.id -> 마지막 렌더 HTML

function render() {
  const container = $('#songs');
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
    query = '';
    $('#search').value = '';
    document.querySelectorAll('.filter').forEach((b) =>
      b.classList.toggle('on', b.dataset.filter === 'all'),
    );
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
