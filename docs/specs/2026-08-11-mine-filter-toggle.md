# 스펙: '내 곡' 필터 토글 분리 (모집 완료된 내 곡 모아보기)

2026-08-11 · 승인됨

## 목적

"모집 완료된 내 곡"을 한 번에 모아본다. 현행 필터 칩(전체/모집 중/모집 완료/내 곡)은
단일 선택이라 '모집 완료 ∧ 내 곡' 조합이 불가능하다. '내 곡'을 상태 필터와 독립된
토글로 분리해 조합을 가능하게 한다 ('모집 중 ∧ 내 곡'도 자연히 지원).

'내 곡'의 정의는 현행 유지: 내가 세션에 이름을 올린 곡 (제안만 한 곡은 제외).

## 상태 모델 (public/app.js)

- `filter`: 상태 필터만 담당 — `'all' | 'open' | 'full'`. `'mine'` 값 제거.
- `mineOnly`: 새 모듈 스코프 boolean, 기본 `false`. '내 곡' 칩 클릭이 토글.
- `isMine(song)` 헬퍼 추출: `SESSIONS.some((s) => song.members[s].includes(me))`.
  `inCategory`의 `'mine'` 분기는 제거하고 목록·카운트가 이 헬퍼를 공유.
- `matchesFilter(song)` = `inCategory(song, filter) && (!mineOnly || isMine(song)) && 검색어 매칭`.

## 칩 카운트 — "누르면 보게 될 수"

각 칩의 숫자는 그 칩을 활성화했을 때 보게 될 목록 크기 (반대 축의 현재 상태 반영):

- 상태 칩: `inCategory(s, 칩) && (mineOnly ? isMine(s) : true)`
- 내 곡 칩: `isMine(s) && inCategory(s, filter)` — 토글 상태와 무관하게 이 식.
- 검색어는 기존처럼 카운트에서 제외.
- 활성 표시: 상태 칩은 `filter === 칩`, 내 곡 칩은 `mineOnly`로 `.on` 토글.

## UI (public/index.html · style.css)

- '내 곡' 버튼은 `#filters` 안에 유지, `mine` 클래스 추가. `data-filter="mine"` 유지.
- CSS: `.filter.mine`에 얇은 구분선(border-left)과 간격. ON 상태는 기존 `.on` 재사용.
- 클릭 핸들러: `data-filter === 'mine'`이면 `mineOnly = !mineOnly`, 아니면 기존대로
  `filter` 교체. 어느 쪽이든 `render()` 호출 (keyed diff 구조 무변경 — 파생 상태는
  render에서 계산한다는 기존 규칙 준수).

## 리셋 경로 2곳

`mineOnly = false`를 함께 수행:

1. 빈 상태의 '필터 초기화' 버튼 (`#clear-filter`).
2. 곡 추가 직후 초기화 (`filter = 'all'` 하는 곳) — 새 곡은 세션 신청 전이라
   토글이 켜져 있으면 방금 추가한 곡이 숨겨지기 때문.

## 플레이리스트 추출 연동

- 추출 범위는 `matchesFilter` 사용이므로 자동 반영.
- `autoPlaylistName()`: `FILTER_LABEL`에서 `mine` 제거, `mineOnly`면 이름 끝에
  `· 내 곡` 추가. 예: `합주 세트리스트 8.11 · 모집 완료 · 내 곡`.

## 범위 밖

- 서버 변경 없음. `public/` 3파일만 수정 (라이브 서비스는 디스크 서빙 — 저장 즉시 반영).
- 필터 상태 영속화(localStorage) 없음 (현행도 없음).

## 성공 기준

1. '모집 완료' + 내 곡 ON → 완주 확정된 내 곡만 표시.
2. 모든 칩 카운트 = 그 칩을 눌렀을 때 실제 보게 될 곡 수.
3. '필터 초기화'와 곡 추가가 `mineOnly`도 해제.
4. 추출 모달의 곡 범위·자동 이름에 조합 반영.
5. 카드 깜빡임 회귀 없음 (keyed diff 유지).
