# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

밴드 합주곡 신청 관리 웹앱 (구글시트 대체). 빌드 도구·프레임워크·테스트 스위트 없음 — Express가 유일한 의존성이고 프론트는 바닐라 JS 3파일이다. UI 문구는 한국어.

## 명령

```bash
npm start                          # 서버 (localhost:3000). ACCESS_CODE env로 인증코드 지정
```

검증은 curl + 브라우저로 한다. API는 인증 헤더가 필수:

```bash
curl -X POST localhost:3000/api/auth -H 'Content-Type: application/json' -d '{"code":"..."}'
curl -H 'x-access-code: <코드>' localhost:3000/api/songs
```

### 운영 (소유자 Mac 한정)

라이브 서비스는 이 Mac의 launchd가 관리한다. **터미널에서 `npm start`로 띄우면 launchd 인스턴스와 포트가 충돌**하니 주의.

- `com.okmin.concert.server` / `com.okmin.concert.tunnel` (`~/Library/LaunchAgents/`, KeepAlive)
- 공개 URL: https://concert.okm.studio ← cloudflared named tunnel `concert` (`~/.cloudflared/config.yml`)
- `public/` 수정은 즉시 반영(디스크에서 서빙). `server.js`·`data.json` 수정은 재시작 필요:
  `launchctl kickstart -k gui/$(id -u)/com.okmin.concert.server`
- 로그: `~/Library/Logs/concert-{server,tunnel}.log`
- Apple Music 연동: MusicKit developer token env(`APPLE_TEAM_ID`·`APPLE_KEY_ID`·`APPLE_MUSIC_KEY_PATH`)는 server plist의 EnvironmentVariables에, `.p8` 키 파일은 `~/.concert/`(repo 밖)에 둔다. env 변경은 kickstart가 아니라 bootout→bootstrap으로 재로드.

## 아키텍처

**server.js (단일 파일)** — Express + `data.json` 파일 저장소. DB 전체를 메모리에 들고 있다가 변경 시 원자적으로 저장(tmp→rename). 따라서 **data.json을 손으로 고치면 반드시 서버를 재시작**해야 한다 — 메모리 사본이 다음 save()에서 파일을 덮어쓴다.

- 인증: 공용 `ACCESS_CODE` 1개. `/api/auth`(레이트리밋: CF-Connecting-IP 기준 분당 10회, timing-safe 비교) 외 모든 `/api/*`는 `x-access-code` 헤더 없으면 401. 클라이언트는 URI 인코딩해 보내고 서버가 디코드한다(비ASCII 코드 지원). 가드는 위치 의존 미들웨어 — **새 API 라우트는 반드시 가드 아래에 등록**.
- `cleanLink()`: 곡 링크는 http(s)만 저장 (javascript: XSS 차단). 링크 관련 필드 추가 시 같은 처리 필요.
- 합주 일정(`/api/schedule*`): when2meet식 조율. `db.schedule = {dates, startHour, endHour, availability: {이름: ["YYYY-MM-DDTHH:MM"...]}, confirmed}` — 슬롯은 15분 단위(MM은 00·15·30·45), 시간 단위 입력("…THH")은 `quarterize()`가 4칸으로 펼친다(부팅 시 구데이터 마이그레이션 + MCP 관용 입력 겸용). 구버전 data.json엔 schedule이 없어서 부팅 시 기본값 주입. 가용 시간은 PUT으로 통째 교체(빈 배열 = 삭제)이고, **칠한 날짜는 dates(후보)로 자동 등록**된다 — 별도 '날짜 올리기' 없음, 확정된 날짜의 슬롯만 폐기. 후보 날짜 삭제 시 그 날짜 슬롯도 스크럽(`dropCandidateDate()`). **확정하면 그 날짜는 후보에서 자동 제거**되고, 제거 직전에 확정 시간대 가능 멤버를 `confirmed[].avail`로 스냅샷(카드 아바타용) — 부팅 시에도 확정∩후보 겹침을 같은 규칙으로 정리. 확정 취소는 후보를 복원하지 않는다(재조율은 날짜 재등록). `setAvailability()`는 웹·MCP 공용. confirmed의 start·end는 시간 단위 정수.
- `/api/parse-link`: YouTube·Spotify·SoundCloud oEmbed로 "아티스트 - 제목" 분해 (서버 경유 — CORS 회피).
- `/mcp`: MCP Streamable HTTP (무상태 JSON-RPC 직접 구현, SDK 없음) — 프데(Friday) 등 에이전트 연동. 툴 6개: `list_songs`·`get_song`·`join_session`·`leave_session`·`get_schedule`·`set_availability`. 인증은 웹과 같은 `x-access-code` 헤더인데 `/api` 가드 밖 경로라 핸들러 안에서 직접 검사한다. 신청/취소 이름은 members.json 프로필과 대소문자 무시로 대조해 유령 이름을 차단(프로필 파일이 없으면 웹처럼 그대로 신뢰).
- 개선 제안 → GitHub 이슈: 로컬 `gh` CLI 사용 (repo는 git remote에서 자동 감지, `FEEDBACK_REPO` env로 재정의). 다른 호스팅으로 옮기면 이 부분은 GitHub API + 토큰으로 교체해야 한다.

**public/app.js (단일 모듈)** — 상태는 모듈 스코프 변수(`songs`, `me`, `accessCode`, `filter`, `query`, `expanded` Set), 렌더는 **keyed diff**:

- `render()`가 곡 id별 HTML 캐시(`cardCache`)와 비교해 **바뀐 카드만 DOM 교체**. 이미지 재로드·애니메이션 재생·입력 중 텍스트 소실을 막는 핵심 구조다. **`innerHTML` 통짜 재작성이나 카드 `outerHTML` 교체를 다시 들여오지 말 것** (깜빡임 회귀).
- 행 펼침(`toggle`)은 재렌더 없이 클래스만 토글하고 `cardCache`를 갱신해 다음 diff와 동기화한다. 유튜브 플레이어 iframe은 펼칠 때 주입, 접을 때 제거(재생 중지).
- 펼친 카드의 세션 신청은 무대 포지션 UI(`stageHTML`) — 빈 자리(`spot free`)가 join, 채워진 자리가 leave 버튼이고 기존 `data-act` 위임을 그대로 쓴다. 빈 자리에 `empty` 클래스 금지 — 빈 목록 상태 박스 `.empty` 규칙과 충돌한다.
- 등장 애니메이션은 `#songs.intro` 하위에서만 — 첫 로드에만 붙는 클래스.
- 파생 상태는 전부 `render()`에서 계산: 필터 칩 활성(`.on`)·카운트는 `filterCounts()`, 분류 술어는 `inCategory()` 하나를 목록·카운트가 공유한다. **me/filter에 의존하는 UI를 추가하면 그 상태 변경 경로에서 `render()`가 불리는지 확인할 것** (login, 필터 클릭 등이 이미 그렇게 한다).
- 401 응답은 `api()`가 `clearAuth()`로 일괄 처리(모달 닫기 포함). 액션 핸들러의 catch는 `!accessCode`면 조용히 리턴한다.
- 합주 일정 섹션은 곡 리스트 keyed diff와 독립 — `renderSchedule()`이 `schedCache`(HTML 문자열)로 통짜 innerHTML 교체를 억제하고, 드래그 페인트 중(`painting`)·입력 포커스 중엔 재렌더를 미룬다. UI는 when2meet 인터랙션 × 노션 캘린더식 **주간 뷰**: 열은 항상 월~일 7요일(`weekStart` 상태, ‹/오늘/› 네비). **미래 날짜는 전부 바로 칠 수 있고**(칠하면 서버가 후보 자동 등록), `.sg-off` 비활성 컬럼은 지난 날짜와 확정된 날짜뿐(누르면 `flashHint` 안내), 요일 헤더 ✕는 그 날짜 조율 내리기. 그리드 2개(왼쪽 `.sgm-cell` = 내 가능 시간 칠하기, 오른쪽 `.sgg-cell` = 그룹 히트맵 + 범례), 페인트는 **사각형 선택**(`paintRect()` — 시작 칸~현재 칸 직사각형을 페인트 전 스냅샷(`pre`) 기준으로 매번 재계산 → 드래그를 되돌리면 원상복구) 후 pointerup에 통째 PUT. 그룹 칸 hover/탭은 `#sg-pop`(가능·불가 명단, 커서 추종). 키보드는 click `e.detail===0` 폴백. 셀 `touch-action: none`이 모바일 드래그 페인트의 전제. 확정·응답 UX(B+C): 가장 가까운 확정 건은 `.gig-hero` 카드(D-day·avail 스냅샷 아바타·`.ics` 생성·공지 문구 복사), 조율 중엔 `.sched-board` 응답 링+칩(members.json 필수 — 없으면 기존 응답자 줄로 폴백)과 "콕 찌르기"(멘션 문구 클립보드 복사 — Slack 연동 아님). 확정된 날짜는 주간 뷰에서 `done` 컬럼(칠기 불가, 확정 시간대 앰버 틴트). 클립보드 버튼 피드백은 DOM만 바꾸므로(`copySwap`) 데이터 변화 없는 동안만 유지된다.
- 아이콘은 `ICONS` 레지스트리의 인라인 SVG만 사용 — UI 크롬에 이모지 금지(리액션 콘텐츠는 예외).
- 세션 어휘(vocal/guitar/bass/drum/keyboard)는 server.js `SESSIONS`와 app.js `SESSION_META` **양쪽에 중복 정의** — 바꿀 때 둘 다.

**public/style.css** — 무대(스테이지) 테마 토큰이 `:root`에 있다 (차콜+앰버, Black Han Sans 디스플레이 / IBM Plex Sans KR 본문). 아코디언 패턴: 컨테이너 `grid-template-rows 0fr↔1fr` + **패딩 없는 클립 자식**(`overflow:hidden; min-height:0; visibility`) — 패딩 있는 요소에 직접 overflow를 주면 접혀도 패딩 높이가 남으니 래퍼를 없애지 말 것. 접힘 시 `visibility: hidden`이 탭 순서 제외를 담당한다.

## repo에 없는 파일 (gitignore, 개인정보)

- `data.json` — 곡·신청자·코멘트 실데이터. 스키마는 server.js 참고. 코멘트 `reactions`는 `{이모지: [이름...]}`.
- `members.json` — Slack #yb 멤버 프로필 `{"members":[{"name","slack","avatar"}]}`. 로그인 게이트의 프로필 그리드가 이걸 쓴다. `GET /api/members`가 요청마다 파일을 읽으므로 수정에 재시작 불필요.

**이 두 파일과 실명·아바타 URL을 공개 repo에 커밋하지 말 것.**

## 도메인 규칙 (시트 문화의 이식)

- 세션 정원 초과 신청 허용(빨간 카운트로 표시 후 밴드가 조율) — 서버는 정원을 강제하지 않는다. 유일한 중복 방지는 같은 세션 같은 이름 409.
- 곡 정보·정원은 구성원 누구나 수정 가능. 신원은 신뢰 기반(프로필 선택일 뿐 인증 아님) — 인증코드는 외부인 차단용이다.
