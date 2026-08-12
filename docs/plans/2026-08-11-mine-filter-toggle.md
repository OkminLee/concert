# '내 곡' 필터 토글 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** '내 곡' 칩을 상태 필터(전체/모집 중/모집 완료)와 독립된 토글로 분리해 '모집 완료된 내 곡' 조합 조회를 가능하게 한다.

**Architecture:** 스펙은 `docs/specs/2026-08-11-mine-filter-toggle.md`. `public/app.js`에 `mineOnly` boolean 상태와 `isMine()` 술어를 추가하고, `filter`는 `'all'|'open'|'full'`만 담당. 목록(`matchesFilter`)·칩 카운트(`filterCounts`)·추출 모달이 같은 술어를 공유한다. 서버 변경 없음.

**Tech Stack:** 바닐라 JS 3파일 (`public/app.js`·`index.html`·`style.css`). 빌드·테스트 스위트 없음 — 검증은 `node --check` + 브라우저 (프로젝트 CLAUDE.md).

## Global Constraints

- keyed diff 렌더 유지 — `innerHTML` 통짜 재작성·카드 `outerHTML` 교체 금지 (프로젝트 CLAUDE.md).
- 파생 상태(칩 활성·카운트)는 전부 `render()` → `filterCounts()`에서 계산.
- UI 크롬에 이모지 금지, 아이콘은 `ICONS` 인라인 SVG만 (이번 변경엔 아이콘 불필요).
- `public/`은 라이브 서비스가 디스크에서 즉시 서빙 — 저장 즉시 배포됨. 자산 변경 시 `index.html`의 `?v=` 캐시 버전을 app.js·style.css **동시에** 올린다 (index.html:11 주석).
- git add/commit은 사용자 지시 시에만 (사용자 전역 규칙) — 이 계획에 커밋 단계 없음.

---

### Task 1: app.js — mineOnly 상태·술어·핸들러·카운트·리셋·추출 이름

**Files:**
- Modify: `public/app.js:37` (상태 선언), `:246-251` (필터 클릭), `:328-336` (inCategory), `:427-445` (matchesFilter·filterCounts), `:223-226` (곡 추가 리셋), `:539-545` (필터 초기화), `:692-697` (FILTER_LABEL·autoPlaylistName)

**Interfaces:**
- Produces: 모듈 상태 `mineOnly: boolean`, 술어 `isMine(song): boolean`. Task 2의 `.filter.mine` 칩이 `data-filter="mine"`으로 이 핸들러·카운트에 연결된다.

- [ ] **Step 1: 상태 선언 추가** — `let filter = 'all';` (37행) 아래에:

```js
let filter = 'all'; // 상태 필터: all | open | full
let mineOnly = false; // '내 곡' 토글 — 상태 필터와 독립 조합
```

- [ ] **Step 2: 필터 클릭 핸들러 분기** — 246-251행:

```js
$('#filters').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter');
  if (!btn) return;
  if (btn.dataset.filter === 'mine') mineOnly = !mineOnly;
  else filter = btn.dataset.filter; // 활성 표시는 render → filterCounts가 파생
  render();
});
```

- [ ] **Step 3: isMine 추출, inCategory에서 'mine' 분기 제거** — 327-336행:

```js
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
```

- [ ] **Step 4: matchesFilter에 토글 조건** — 427행 함수 첫머리:

```js
function matchesFilter(song) {
  if (!inCategory(song, filter)) return false;
  if (mineOnly && !isMine(song)) return false;
  // (이하 query 검사 기존 그대로)
```

- [ ] **Step 5: filterCounts — "누르면 보게 될 수" + 토글 활성 표시** — 437-445행 교체:

```js
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
```

- [ ] **Step 6: 리셋 경로 2곳** — 곡 추가 성공 후(224행) `filter = 'all';` 다음 줄에 `mineOnly = false; // 새 곡은 세션 신청 전이라 토글이 켜져 있으면 숨겨진다`, '필터 초기화'(540행) `filter = 'all';` 다음 줄에 `mineOnly = false;`.

- [ ] **Step 7: 추출 자동 이름** — 692-697행:

```js
const FILTER_LABEL = { open: '모집 중', full: '모집 완료' };
function autoPlaylistName() {
  const d = new Date();
  const label =
    (FILTER_LABEL[filter] ? ` · ${FILTER_LABEL[filter]}` : '') + (mineOnly ? ' · 내 곡' : '');
  return `합주 세트리스트 ${d.getMonth() + 1}.${d.getDate()}${label}`;
}
```

- [ ] **Step 8: 문법 검증** — Run: `node --check public/app.js` / Expected: 출력 없이 exit 0.

### Task 2: index.html·style.css — mine 칩 구분선 + 캐시 버전

**Files:**
- Modify: `public/index.html:12,104,196`, `public/style.css:434` 아래

**Interfaces:**
- Consumes: Task 1의 클릭 핸들러 분기 (`data-filter="mine"` 유지 필수).

- [ ] **Step 1: mine 클래스 추가** — index.html 104행:

```html
<button type="button" class="filter mine" data-filter="mine">내 곡 <span class="cnt"></span></button>
```

- [ ] **Step 2: 구분선 CSS** — style.css `.filter.on .cnt` 규칙(434행) 아래에:

```css
/* '내 곡'은 상태 필터와 독립 토글 — 얇은 구분선으로 분리 */
.filter.mine { margin-left: 6px; position: relative; }
.filter.mine::before {
  content: '';
  position: absolute;
  left: -6px;
  top: 20%;
  height: 60%;
  border-left: 1px solid var(--line);
}
```

(`.filters`의 `gap: 6px` + `margin-left: 6px` = 12px 틈의 가운데에 선이 온다.)

- [ ] **Step 3: 캐시 버전 동시 갱신** — index.html 12행 `style.css?v=3` → `?v=4`, 196행 `app.js?v=3` → `?v=4`.

### Task 3: 브라우저 검증 (localhost:3000, 읽기 전용 조작만)

**Files:** 없음 (검증 전용). 라이브 데이터이므로 세션 신청/삭제 등 변이 액션 금지 — 필터 클릭·모달 열기만.

- [ ] **Step 1: 로그인** — launchd plist에서 `ACCESS_CODE` 확인 후 localhost:3000 접속, 코드 입력·프로필 선택.
- [ ] **Step 2: 조합 동작** — '모집 완료' + '내 곡' ON → 내가 참여 중이고 완주 확정인 곡만 보이는지. '모집 중' + '내 곡'도 확인. 둘 다 `.on` 앰버 활성 표시.
- [ ] **Step 3: 카운트 정합** — 각 칩 숫자가 "그 칩을 눌렀을 때 보게 될 곡 수"와 일치하는지: 내 곡 ON 상태에서 상태 칩 카운트가 내 곡 범위로 줄고, 표시 목록 곡 수 = 활성 칩 카운트.
- [ ] **Step 4: 리셋** — 곡이 0개가 되는 조합에서 빈 상태 '필터 초기화' 클릭 → 토글 해제·전체 복귀.
- [ ] **Step 5: 추출 모달** — 모집 완료+내 곡 상태에서 추출 열기 → 곡 범위가 조합과 일치, 이름이 `합주 세트리스트 8.11 · 모집 완료 · 내 곡`.
- [ ] **Step 6: 깜빡임 회귀** — 필터 전환 시 남는 카드의 이미지/애니메이션 재로드 없는지 육안 확인.
