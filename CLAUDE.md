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

## 아키텍처

**server.js (단일 파일)** — Express + `data.json` 파일 저장소. DB 전체를 메모리에 들고 있다가 변경 시 원자적으로 저장(tmp→rename). 따라서 **data.json을 손으로 고치면 반드시 서버를 재시작**해야 한다 — 메모리 사본이 다음 save()에서 파일을 덮어쓴다.

- 인증: 공용 `ACCESS_CODE` 1개. `/api/auth`(레이트리밋: CF-Connecting-IP 기준 분당 10회, timing-safe 비교) 외 모든 `/api/*`는 `x-access-code` 헤더 없으면 401. 클라이언트는 URI 인코딩해 보내고 서버가 디코드한다(비ASCII 코드 지원). 가드는 위치 의존 미들웨어 — **새 API 라우트는 반드시 가드 아래에 등록**.
- `cleanLink()`: 곡 링크는 http(s)만 저장 (javascript: XSS 차단). 링크 관련 필드 추가 시 같은 처리 필요.
- `/api/parse-link`: YouTube·Spotify·SoundCloud oEmbed로 "아티스트 - 제목" 분해 (서버 경유 — CORS 회피).
- 개선 제안 → GitHub 이슈: 로컬 `gh` CLI 사용 (repo는 git remote에서 자동 감지, `FEEDBACK_REPO` env로 재정의). 다른 호스팅으로 옮기면 이 부분은 GitHub API + 토큰으로 교체해야 한다.

**public/app.js (단일 모듈)** — 상태는 모듈 스코프 변수(`songs`, `me`, `accessCode`, `filter`, `query`, `expanded` Set), 렌더는 **keyed diff**:

- `render()`가 곡 id별 HTML 캐시(`cardCache`)와 비교해 **바뀐 카드만 DOM 교체**. 이미지 재로드·애니메이션 재생·입력 중 텍스트 소실을 막는 핵심 구조다. **`innerHTML` 통짜 재작성이나 카드 `outerHTML` 교체를 다시 들여오지 말 것** (깜빡임 회귀).
- 행 펼침(`toggle`)은 재렌더 없이 클래스만 토글하고 `cardCache`를 갱신해 다음 diff와 동기화한다. 유튜브 플레이어 iframe은 펼칠 때 주입, 접을 때 제거(재생 중지).
- 펼친 카드의 세션 신청은 무대 포지션 UI(`stageHTML`) — 빈 자리(`spot free`)가 join, 채워진 자리가 leave 버튼이고 기존 `data-act` 위임을 그대로 쓴다. 빈 자리에 `empty` 클래스 금지 — 빈 목록 상태 박스 `.empty` 규칙과 충돌한다.
- 등장 애니메이션은 `#songs.intro` 하위에서만 — 첫 로드에만 붙는 클래스.
- 파생 상태는 전부 `render()`에서 계산: 필터 칩 활성(`.on`)·카운트는 `filterCounts()`, 분류 술어는 `inCategory()` 하나를 목록·카운트가 공유한다. **me/filter에 의존하는 UI를 추가하면 그 상태 변경 경로에서 `render()`가 불리는지 확인할 것** (login, 필터 클릭 등이 이미 그렇게 한다).
- 401 응답은 `api()`가 `clearAuth()`로 일괄 처리(모달 닫기 포함). 액션 핸들러의 catch는 `!accessCode`면 조용히 리턴한다.
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
