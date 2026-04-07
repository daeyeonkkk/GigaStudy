# GigaStudy

GigaStudy는 웹에서 보컬 take를 녹음하고, 사후 정렬과 채점을 거쳐 반자동 아카펠라 편곡까지 이어지는 학습 스튜디오를 만드는 프로젝트다.

현재 레포는 Phase 1인 녹음 파이프라인과 DeviceProfile 기반을 시작할 수 있는 최소 실행 구조를 포함한다.

## Repository Layout

- `apps/web`
  React 19 + Vite 기반 웹 스튜디오
- `apps/api`
  FastAPI 기반 API와 향후 분석 워커의 시작점
- `PROJECT_FOUNDATION`
  제품 기준, 로드맵, 체크리스트, Phase 1 백로그

## Quick Start

### 1. Web

```bash
npm install
npm run dev:web
```

### 2. API

```bash
cd apps/api
uv sync
uv run alembic upgrade head
uv run uvicorn gigastudy_api.main:app --reload --app-dir src
```

API는 기본적으로 로컬 개발용 저장소를 `apps/api/storage` 아래에 만들고, guide 업로드 파일을 여기에 저장한다.

### 3. API Test

```bash
cd apps/api
uv run pytest
```

## Current Focus

- 프로젝트 생성과 스튜디오 진입 흐름
- 마이크 권한, 장치 선택, 실제 오디오 설정값 저장
- guide / take 업로드 수명주기
- 기본 믹서와 mixdown 저장 경로

## Foundation Docs

- [Master Plan](./PROJECT_FOUNDATION/GigaStudy_master_plan.md)
- [Roadmap](./PROJECT_FOUNDATION/ROADMAP.md)
- [Phase 1 Backlog](./PROJECT_FOUNDATION/PHASE1_BACKLOG.md)
- [Checklist](./PROJECT_FOUNDATION/GigaStudy_check_list.md)
