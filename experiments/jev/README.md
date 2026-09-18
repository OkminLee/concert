# Jev 검색 분류 실험

운영 코드와 분리한 평가 도구. 공개 YouTube 검색 결과의 제목·채널명만 사용한다.

1. `node experiments/jev/collect.js` — 기본 검색어 5개에서 총 50개 고유 결과 수집. 기존 samples.json이 있으면 중단한다.
2. samples.json을 보고 labels.json을 작성한다. 각 id에 `{ kind: "music|tutorial|other|unknown", live: true|false|null, cover: true|false|null }`를 기록한다. null은 메타데이터만으로 모름. 모델 결과를 보기 전에 확정한다. 자동 작성한 라벨은 사람 정답으로 보고하지 않는다.
3. `node experiments/jev/evaluate.js` — 키워드 기준선 평가(외부 호출 없음).
4. `node experiments/jev/evaluate.js --jev` — TYPESAFE_API_KEY 환경변수 또는 `~/.concert/typesafe.json`의 api_key로 실제 API 호출. 50개 기준 최대 50회, 순차 실행. 재시도 없음. 결과 파일이 이미 있으면 재과금 방지를 위해 중단한다.

API 키 파일은 repo 밖에 두고 권한 600으로 관리한다. 키를 출력하지 않는다. 기존 .env 파일은 수정하지 않는다.

Jev confidence는 정답 확률이 아니다. 임시 표시 기준은 Choice confidence >= 0.7, Noul >= 0.9이고, 이 평가로 적합성을 판단한다. 라이브·커버는 동시에 참일 수 있다. ‘음악’은 원곡 판정이 아니다.

성공 기준: 키워드보다 배지 정밀도를 떨어뜨리지 않으면서 표시 가능한 올바른 배지가 늘어나는지 본다. 50개는 예비 평가이며 임계값 조정 후에는 별도 검증셋이 필요하다. 응답시간 p50/p95와 토큰 사용량을 기록한다. 가격표 확인 전 금액을 추정하지 않는다.

API 실패는 평가 실패로 남긴다. 실제 검색에는 아직 연결하지 않는다. 향후 배지는 인증된 별도 비동기 API, 서버 캐시, 검색 요청 세대 확인을 통해 추가하고 지연·실패가 검색/등록을 막지 않도록 한다.

되돌리기: 현재는 experiments/jev만 제거하면 된다. 운영 파일·프로세스·데이터는 변경하지 않는다.
