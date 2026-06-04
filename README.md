# GigaStudy

GigaStudy는 6성부 아카펠라 편곡과 연습을 위한 웹 스튜디오입니다. 사용자는 하나의 음악 시간축 위에서 여섯 트랙을 채우고, 싱크를 맞추고, waterfall view로 연습한 뒤 자신의 녹음을 기준 트랙과 비교해 피치/리듬 리포트를 받을 수 있습니다.

이 저장소는 공개 가능한 소스와 제품 문서를 담은 public repo입니다. 실제 개발 history와 운영용 비공개 자료는 `GigaStudy-private`에서 관리합니다.

## 제품 방향

GigaStudy는 악보 편집기가 아니라 **연습 중심 스튜디오**입니다. PDF/MIDI/MusicXML, 직접 녹음, 파일 업로드, AI 생성 결과는 모두 하나의 6트랙 timeline 위의 region과 pitch event로 정리됩니다.

고정 트랙은 다음 여섯 개입니다.

- Soprano
- Alto
- Tenor
- Baritone
- Bass
- Percussion

## 핵심 흐름

1. 악보/문서 업로드 또는 빈 6트랙 board에서 studio 생성
2. 여섯 트랙을 녹음, 업로드, AI 생성으로 채우기
3. region lane과 piano roll event를 조정하고 waterfall view로 연습
4. 선택한 reference track과 자신의 녹음을 비교해 피치/리듬 리포트 생성

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| Web | React, Vite, TypeScript |
| API | FastAPI, Python, uv |
| Audio/Pitch | pitch event engine, sync engine, scoring engine |
| Storage | local storage, optional Postgres metadata, optional S3/R2 assets |
| Test | pytest, Playwright, npm build/lint |
| Deploy | Cloud Run API, Cloudflare Pages/R2 alpha 운영 기준 |

## 저장소 구조

```text
GigaStudy
├── apps/web                # React client
├── apps/api                # FastAPI service
├── e2e                     # Playwright smoke tests
├── ops                     # alpha deploy/env templates
├── PROJECT_FOUNDATION      # 제품/아키텍처 기준 문서
└── tests                   # web/api 검증
```

## 실행

```bash
npm install
cd apps/api
uv sync
uv run uvicorn gigastudy_api.main:app --reload --app-dir src
npm run dev:web
```

## 검증

```bash
cd apps/api
uv run pytest
npm run build:web
npm run lint:web
npm run test:e2e
```

## 공개/비공개 경계

공개 repo에는 alpha env, R2/S3 credential, DeepSeek/API key, 관리자 password, 업로드 음원, local storage, sample recording을 넣지 않습니다. 운영 secret과 전체 개발 history는 private repo와 secret manager에서 관리합니다.
