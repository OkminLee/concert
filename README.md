# 🎸 합주 세트리스트

밴드 합주곡 신청·관리 웹앱. 기존 구글시트('곡 적기' 탭) 워크플로를 그대로 옮겼다.

## 기능

- **상태별 탐색** — 모집 시작 / 모이는 중 / 완료 임박 / 모집 완료를 보드나 목록으로 탐색. 파트별 빈자리 필터·모집 단계·내 곡을 조합하고 곡명/뮤지션/최근 추가순으로 정렬. 정원이 0인 곡은 별도 분류한다.
- **음악 서비스 검색 추가** — 곡 추가에서 YouTube·Apple Music·Spotify 검색 → 결과 선택 → 곡 정보와 파트 정원 확인 → 등록. 동일 링크의 중복 등록은 차단한다.

- **인증코드 게이트** — 입장 전 밴드 공용 인증코드 입력 (`ACCESS_CODE` env로 설정 — **운영 시 반드시 기본값에서 변경**). 모든 API도 코드 헤더 없으면 401, `/api/auth`는 IP당 분당 10회 제한. 기기당 1회 입력 후 저장
- **프로필 로그인** — Slack #yb 멤버 프로필(아바타)을 골라 입장, 선택은 저장되어 재입장 시 생략. 목록에 없으면 닉네임 직접 입력
- **곡 추가**
  - 자동: YouTube · Spotify · SoundCloud 링크 붙여넣기 → `자동 인식` → 뮤지션/곡명 자동 분해 (oEmbed 기반)
  - 수동: 뮤지션·곡명 직접 입력
- **세션별 정원** — vocal / guitar / bass / drum / keyboard, 곡마다 0~9명 자유 설정 (키보드 없는 곡 = 0)
- **세션 신청** — `+ 하고싶어요`로 이름 올리기, 정원 초과 신청 허용 (빨간 숫자로 표시 후 조율)
- **곡 수정·삭제** — 구성원 누구나 인원수·곡 정보 수정 가능 (시트 문화 그대로)
- **코멘트 + 리액션** — 곡마다 자유 발언, 코멘트별 이모지 리액션 토글
- **개선 제안** — 헤더 `개선 제안` → GitHub 이슈 자동 생성 (서버에서 `gh` CLI 사용, `FEEDBACK_REPO` env로 대상 지정 가능)
- **사용법 탭** — 헤더 `사용법` 버튼 (시트의 설명 탭)

프로필 목록은 `members.json`(repo 미포함, `{"members":[{"name","slack","avatar"}]}`)에서 읽는다.

## 실행

```bash
npm install
npm start          # http://localhost:3000
```

데이터는 `data.json` 파일 하나에 저장된다 (DB 불필요).

## Public 배포

현재 **https://concert.okm.studio** — 로컬 서버를 Cloudflare named tunnel(`concert`)로 노출한다.

```bash
ACCESS_CODE=<밴드 공용 코드> npm start   # 서버 (localhost:3000)
cloudflared tunnel run concert           # 고정 도메인 터널 (~/.cloudflared/config.yml)
```

둘 다 이 Mac에서 떠 있어야 접속된다. 재시작해도 URL은 유지된다.

상시 클라우드 운영으로 옮길 때는 Node 서버 + 파일 저장소 구조라 **퍼시스턴트 디스크가 있는 호스팅**이 필요하다:

- **Railway / Render / Fly.io** — repo 연결 후 `npm start`, 볼륨 1개 마운트해서 `data.json` 유지
- Vercel/Netlify 같은 serverless는 파일 저장이 유지되지 않아 부적합 (쓰려면 저장소를 DB로 교체 필요)

## API

`GET /api/music-search?provider=youtube|apple|spotify&q=검색어`는 인증 후 곡 후보 목록을 반환한다.
Apple Music은 기존 MusicKit 환경 설정을 사용한다. Spotify 검색은 `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` 또는 서버 계정의 `~/.concert/spotify.json` (`client_id`, `client_secret`, 권한 600)을 사용한다. 키는 저장소와 브라우저에 넣지 않는다.
YouTube 검색은 기존 검색 페이지의 `ytInitialData`를 파싱하며, 응답 구조 변경 시 명시적인 오류를 반환한다. 공식 Data API 연결은 아직 사용하지 않는다.

`npm test`로 모집 분류의 경계 조건·링크 정규화·YouTube 파싱을 검사한다. UI/API 쓰기 검증은 별도 사본과 별도 포트에서 실행하고 운영 `data.json`으로 시험하지 않는다.

`POST /api/auth {code}`로 코드를 검증하고, 이후 모든 요청에 `x-access-code: <URI 인코딩된 코드>` 헤더가 필요하다 (없으면 401).

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/songs` | 곡 목록 |
| POST | `/api/songs` | 곡 추가 `{title, artist, link, slots, nickname}` |
| PATCH | `/api/songs/:id` | 곡 정보·정원 수정 |
| DELETE | `/api/songs/:id` | 곡 삭제 |
| POST/DELETE | `/api/songs/:id/members` | 세션 참가/빠지기 `{session, name}` |
| POST | `/api/songs/:id/comments` | 코멘트 작성 |
| DELETE | `/api/songs/:id/comments/:cid` | 코멘트 삭제 |
| POST | `/api/parse-link` | 링크 → `{artist, title}` 자동 분해 |
