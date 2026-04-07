import { useEffect, useState } from 'react'
import { apiBaseUrl, buildApiUrl } from './lib/api'
import './App.css'

type HealthPayload = {
  env: string
  service: string
  status: string
  version: string
}

type HealthState =
  | { phase: 'loading' }
  | { phase: 'ready'; payload: HealthPayload }
  | { phase: 'error'; message: string }

const priorityCards = [
  {
    title: '프로젝트와 Guide 연결',
    items: [
      '프로젝트 생성과 기본 메타데이터 저장',
      'guide 업로드 및 재생 흐름 연결',
      '스튜디오 첫 진입 라우팅 완성',
    ],
  },
  {
    title: '오디오 설정과 DeviceProfile',
    items: [
      '마이크 권한 요청과 장치 선택',
      'getSettings() 기반 실제 적용값 저장',
      '입력 장치와 출력 경로 조합별 profile upsert',
    ],
  },
  {
    title: 'Take 녹음과 업로드',
    items: [
      '여러 take 연속 녹음',
      '업로드 진행률 및 실패 재시도',
      'guide / take 상태가 보이는 트랙 리스트',
    ],
  },
  {
    title: '후처리 준비',
    items: [
      '메타데이터 프로브 워커',
      'canonical audio 와 peaks 산출물 생성',
      'mixdown artifact 저장 경로 확보',
    ],
  },
] as const

const starterTickets = ['SC-01', 'SC-02', 'BE-01', 'FE-01', 'SC-03'] as const

function App() {
  const [health, setHealth] = useState<HealthState>({ phase: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    async function loadHealth(): Promise<void> {
      try {
        const response = await fetch(buildApiUrl('/api/health'), {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const payload = (await response.json()) as HealthPayload
        setHealth({ phase: 'ready', payload })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setHealth({
          phase: 'error',
          message:
            error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
        })
      }
    }

    void loadHealth()

    return () => controller.abort()
  }, [])

  const healthLabel =
    health.phase === 'loading'
      ? 'API 확인 중'
      : health.phase === 'ready'
        ? 'API 연결 완료'
        : 'API 미연결'

  return (
    <div className="app-shell">
      <section className="hero">
        <div className="hero__copy">
          <p className="eyebrow">GigaStudy • Phase 1 Bootstrap</p>
          <h1>녹음 파이프라인부터 정확하게 쌓는 보컬 학습 스튜디오</h1>
          <p className="hero__summary">
            지금 단계의 목표는 화려한 AI 데모가 아니라, 프로젝트 생성과 guide 연결,
            장치 설정 저장, take 업로드, mixdown 경로까지 흔들리지 않는 기반을 닫는
            것이다.
          </p>

          <div className="chip-row" aria-label="current scope">
            <span className="chip">React 19 + Vite</span>
            <span className="chip">FastAPI</span>
            <span className="chip">DeviceProfile</span>
            <span className="chip">Guide / Take Upload</span>
          </div>
        </div>

        <aside className="status-card" aria-label="api status">
          <div className="status-card__header">
            <span
              className={`status-pill ${
                health.phase === 'ready'
                  ? 'status-pill--ready'
                  : health.phase === 'error'
                    ? 'status-pill--error'
                    : 'status-pill--loading'
              }`}
            >
              {healthLabel}
            </span>
            <p className="status-card__caption">로컬 연결 체크</p>
          </div>

          <dl className="status-grid">
            <div>
              <dt>API base</dt>
              <dd>{apiBaseUrl}</dd>
            </div>
            <div>
              <dt>Service</dt>
              <dd>
                {health.phase === 'ready' ? health.payload.service : 'gigastudy-api'}
              </dd>
            </div>
            <div>
              <dt>Environment</dt>
              <dd>{health.phase === 'ready' ? health.payload.env : 'development'}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{health.phase === 'ready' ? health.payload.version : '0.1.0'}</dd>
            </div>
          </dl>

          {health.phase === 'error' ? (
            <p className="status-card__error">
              `/api/health` 연결에 실패했다. API 서버 실행 전에는 정상이다. 자세한
              메시지: {health.message}
            </p>
          ) : (
            <p className="status-card__hint">
              웹과 API를 동시에 켜면 상태 카드가 즉시 바뀐다.
            </p>
          )}
        </aside>
      </section>

      <section className="section">
        <div className="section__header">
          <p className="eyebrow">Phase 1 Scope</p>
          <h2>이번 단계에서 닫을 네 가지 축</h2>
        </div>

        <div className="card-grid">
          {priorityCards.map((card) => (
            <article className="info-card" key={card.title}>
              <h3>{card.title}</h3>
              <ul>
                {card.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="section section--split">
        <article className="panel">
          <p className="eyebrow">Start Here</p>
          <h2>바로 시작할 티켓</h2>
          <ul className="ticket-list">
            {starterTickets.map((ticket) => (
              <li key={ticket}>
                <strong>{ticket}</strong>
                <span>Phase 1 backlog 기준 우선 착수 묶음</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <p className="eyebrow">Run Locally</p>
          <h2>개발 서버 명령</h2>
          <div className="command-stack">
            <div>
              <span>web</span>
              <code>npm run dev:web</code>
            </div>
            <div>
              <span>api</span>
              <code>cd apps/api &amp;&amp; uv run uvicorn gigastudy_api.main:app --reload --app-dir src</code>
            </div>
            <div>
              <span>test</span>
              <code>cd apps/api &amp;&amp; uv run pytest</code>
            </div>
          </div>
        </article>
      </section>
    </div>
  )
}

export default App
