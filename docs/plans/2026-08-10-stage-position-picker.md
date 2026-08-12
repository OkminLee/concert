# 무대 포지션 선택 UI 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 펼친 곡 카드의 세션 행 UI를 시안 A(정면 무대) 포지션 선택 UI로 교체한다.

**Architecture:** `songCard()`가 세션 행 대신 `stageHTML(song)` 문자열을 생성 — keyed diff·`cardCache`·이벤트 위임(join/leave `data-act`) 구조는 그대로. CSS grid로 무대 배치, 서버 무변경.

**Tech Stack:** 바닐라 JS(단일 모듈 public/app.js), CSS(public/style.css), Express 정적 서빙.

## Global Constraints

- 서버(server.js)·API·data.json 스키마 변경 금지.
- `innerHTML` 통짜 재작성·카드 `outerHTML` 교체 금지 (깜빡임 회귀 — 프로젝트 CLAUDE.md).
- 아이콘은 `ICONS` 인라인 SVG만, UI 크롬 이모지 금지.
- git add/commit은 사용자 지시 시에만 (사용자 전역 규칙).
- `public/`은 라이브에 즉시 반영 — 편집 순서: app.js → style.css → index.html(캐시 버스터 마지막).
- 테스트 스위트 없음 — 검증은 브라우저(localhost:3000)·curl.

---

### Task 1: app.js — stageHTML/spotHTML 추가, songCard 세션 영역 교체

**Files:**
- Modify: `public/app.js` (sessionStat 아래 함수 추가, songCard 내 rows 제거·사용부 교체)

**Interfaces:**
- Produces: `stageHTML(song) -> string` (무대 전체), `spotHTML(s, name, over) -> string` (자리 1개). Task 2의 CSS 클래스(`.stage`, `.stage-grid`, `.zone`, `.zone-label`, `.spots`, `.spot`, `.spot-ava`, `.spot-initial`, `.nm`, `.stage-edge`)와 짝.
- Consumes: 기존 `SESSION_META`, `activeSessions()`, `sessionStat()`, `avatarImg()`, `esc()`, `me`, 위임 핸들러의 `join`/`leave` 케이스.

- [ ] **Step 1: `sessionStat` 함수 아래(275행 부근)에 무대 렌더 함수 추가**

```js
/* ── 무대 포지션 렌더 ── */
// 자리 1개 — 빈 자리는 join, 채워진 자리는 leave (본인/타인 confirm은 기존 핸들러가 분기)
function spotHTML(s, name, over) {
  if (name === undefined)
    return `<button type="button" class="spot empty" data-act="join" data-session="${s}" aria-label="${SESSION_META[s].label} 참가">+</button>`;
  const ava =
    avatarImg(name, 'spot-ava') || `<span class="spot-initial">${esc(name.slice(0, 1))}</span>`;
  return `
    <button type="button" class="spot filled ${name === me ? 'me' : ''} ${over ? 'over' : ''}"
      data-act="leave" data-session="${s}" data-name="${esc(name)}"
      title="${esc(name)}" aria-label="${esc(name)} 빼기">
      ${ava}<span class="nm">${esc(name)}</span>
    </button>`;
}
// 객석에서 본 무대 — 정원만큼 빈 자리, 초과 인원은 over 자리로 이어붙인다
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
      return `
        <div class="zone ${s}">
          <span class="zone-label"><i class="dot ${s}"></i>${m.label} <b class="${cls}">${cnt}/${cap}</b></span>
          <div class="spots">${spots.join('')}</div>
        </div>`;
    })
    .join('');
  return `<div class="stage"><div class="stage-grid">${zones}</div><div class="stage-edge">AUDIENCE · 객석</div></div>`;
}
```

- [ ] **Step 2: `songCard()`의 `const rows = activeSessions(song)…join('');` 블록(약 300–322행, chips·join 버튼 생성부 포함) 전체 삭제**

- [ ] **Step 3: `songCard()` 반환 HTML의 사용부 교체**

기존:
```js
<div class="sessions">${rows || '<p class="count">세션 정원이 아직 없어요 — 수정 버튼으로 채워주세요</p>'}</div>
```
교체:
```js
<div class="sessions">${stageHTML(song)}</div>
```

- [ ] **Step 4: 문법 확인** — `node --check public/app.js` → 에러 없음

### Task 2: style.css — 무대 스타일 추가, 세션 행 스타일 제거

**Files:**
- Modify: `public/style.css` (「세션 줄」 블록 교체, 포커스 목록 갱신)

**Interfaces:**
- Consumes: Task 1의 클래스 이름. 기존 토큰 `--vocal`~`--keyboard`, `--line`, `--ok`, `--danger`, `--amber`, `--mono` 없음 → `'IBM Plex Mono'` 직접 표기.

- [ ] **Step 1: `/* 세션 줄 */` 블록의 `.session-row`, `.chips`, `.chip`, `.chip.me`, `.chip button`, `.chip button:hover`, `.join`, `.join:hover` 규칙 삭제** (`.sessions`, `.tag*`, `.count*`는 유지 — 스테퍼·빈 정원 문구가 사용)

- [ ] **Step 2: 같은 자리에 무대 스타일 추가**

```css
/* 무대 포지션 선택 — 객석에서 본 무대 */
.stage {
  position: relative;
  border: 1px solid var(--line);
  border-radius: 12px;
  background:
    radial-gradient(430px 210px at 50% -50px, rgba(255, 180, 84, 0.15), transparent 70%),
    linear-gradient(180deg, #1a1512, #141009);
  overflow: hidden;
  padding: 14px 12px 0;
}
/* 마루판 */
.stage::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(180deg, transparent 0 30px, rgba(255, 255, 255, 0.022) 30px 31px);
}
.stage-grid {
  position: relative;
  display: grid;
  grid-template-areas:
    'key  drum  .'
    'bass .     guitar'
    '.    vocal .';
  grid-template-columns: 1fr auto 1fr;
  row-gap: 4px;
}
.zone {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 7px;
  padding: 6px 8px 24px; /* 하단은 스팟 아래 이름 자리 */
  justify-self: center;
}
.zone.vocal { grid-area: vocal; --zc: var(--vocal); }
.zone.guitar { grid-area: guitar; --zc: var(--guitar); }
.zone.bass { grid-area: bass; --zc: var(--bass); }
.zone.drum { grid-area: drum; --zc: var(--drum); }
.zone.keyboard { grid-area: key; --zc: var(--keyboard); }
/* 세션색 스포트라이트 풀 */
.zone::before {
  content: ''; position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%);
  width: 110%; height: 30px; border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--zc) 17%, transparent), transparent);
  pointer-events: none;
}
/* 드럼 라이저(단상) */
.zone.drum {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding-top: 8px;
  min-width: 108px;
}
.zone-label {
  display: flex; align-items: center; gap: 5px;
  font: 500 11px var(--body); color: var(--ink-dim); white-space: nowrap;
}
.zone-label b { font-weight: 700; }
.zone-label b.filled { color: var(--ok); }
.zone-label b.over { color: var(--danger); }
.spots { display: flex; gap: 9px; flex-wrap: wrap; justify-content: center; }
.spot {
  position: relative;
  width: 46px; height: 46px; border-radius: 50%;
  border: 2px dashed color-mix(in srgb, var(--zc) 50%, var(--line));
  background: rgba(0, 0, 0, 0.28);
  color: color-mix(in srgb, var(--zc) 70%, var(--ink-dim));
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  font: 500 20px var(--body);
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
.spot.empty:hover {
  border-style: solid; transform: translateY(-2px);
  box-shadow: 0 0 16px color-mix(in srgb, var(--zc) 40%, transparent);
}
.spot.filled { border-style: solid; border-color: color-mix(in srgb, var(--zc) 75%, transparent); }
.spot.me { border-color: var(--amber); box-shadow: 0 0 12px rgba(255, 180, 84, 0.3); }
.spot.over { border-color: var(--danger); box-shadow: 0 0 10px rgba(255, 92, 77, 0.28); }
.spot-ava, .spot-initial {
  width: 36px; height: 36px; border-radius: 50%;
  object-fit: cover;
  display: flex; align-items: center; justify-content: center;
  font: 700 15px var(--body); color: var(--ink);
  background: color-mix(in srgb, var(--zc) 40%, var(--bg-raised));
}
.spot .nm {
  position: absolute; top: calc(100% + 3px); left: 50%; transform: translateX(-50%);
  font-size: 10.5px; color: var(--ink); white-space: nowrap; max-width: 64px;
  overflow: hidden; text-overflow: ellipsis;
}
.spot.me .nm { color: var(--amber); font-weight: 700; }
/* 채워진 자리 hover → 빼기 힌트 */
.spot.filled:hover::after {
  content: '✕'; position: absolute; inset: 0; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgba(19, 17, 16, 0.72); color: var(--danger); font-size: 15px; font-weight: 700;
}
/* 무대 앞턱 = 객석 방향 */
.stage-edge {
  margin: 4px -12px 0;
  border-top: 1px dashed var(--line);
  padding: 5px 0 7px;
  text-align: center;
  font: 500 9.5px 'IBM Plex Mono', monospace; letter-spacing: 0.4em;
  color: rgba(155, 145, 132, 0.55);
}
```

- [ ] **Step 3: 모바일 미디어쿼리(`@media (max-width: 560px)`) 안에 추가**

```css
  .spot { width: 40px; height: 40px; }
  .spot-ava, .spot-initial { width: 31px; height: 31px; font-size: 12.5px; }
  .spot .nm { font-size: 9.5px; max-width: 52px; }
  .zone { padding: 4px 4px 20px; }
  .zone.drum { min-width: 92px; }
```

- [ ] **Step 4: 키보드 포커스 목록에서 `.join:focus-visible` → `.spot:focus-visible`로 교체**

### Task 3: index.html — 사용법 문구·캐시 버스터

**Files:**
- Modify: `public/index.html` (help 다이얼로그 3번째 li, `?v=2` 두 곳)

- [ ] **Step 1: 사용법 3번째 항목 교체**

기존:
```html
<li>하고 싶은 곡의 세션에서 <strong>+ 하고싶어요</strong>를 누르면 내 이름이 올라가요. 정원보다 많아도 일단 올려두고 조율하면 됩니다.</li>
```
교체:
```html
<li>하고 싶은 곡을 펼치면 <strong>무대</strong>가 보여요. 빈 자리 <strong>+</strong>를 누르면 그 자리에 올라가고, 내 자리를 다시 누르면 내려옵니다. 정원보다 많아도 일단 올라가두고 조율하면 됩니다.</li>
```

- [ ] **Step 2: `style.css?v=2` → `style.css?v=3`, `app.js?v=2` → `app.js?v=3`**

### Task 4: 검증·문서 정리

**Files:**
- Modify: `CLAUDE.md` (app.js 아키텍처 문단에 무대 UI 한 줄)

- [ ] **Step 1: 서버 확인** — `curl -s -o /dev/null -w '%{http_code}' localhost:3000` → 200 (launchd 인스턴스, npm start 금지)
- [ ] **Step 2: 브라우저 검증 (데스크톱·375px)** — 스펙 검증 체크리스트 1~5:
  펼침 카드 무대 렌더 / 빈 자리 참가·내 자리 나가기·남의 자리 confirm / 초과 빨간 스팟·정원 0 숨김·전부 0 문구 / 접기·폴링 깜빡임 없음·플레이어 정상 / 접힌 행·곡 적기·수정·추출 회귀 없음
- [ ] **Step 3: CLAUDE.md 갱신** — app.js 절에 "펼친 카드 세션 영역은 무대 포지션 UI(`stageHTML`) — 빈 자리 join·채워진 자리 leave, 스팟은 `data-act` 위임 재사용" 한 줄 추가
- [ ] **Step 4: 결과 보고** — 커밋은 사용자 지시 대기
