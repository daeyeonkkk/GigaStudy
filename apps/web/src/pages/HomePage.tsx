import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { priorityCards, starterTickets } from '../data/phase1'
import { apiBaseUrl, buildApiUrl } from '../lib/api'
import type { Project } from '../types/project'

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

type CreateProjectState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'error'; message: string }

const initialFormState = {
  title: '',
  bpm: '92',
  baseKey: 'C',
  timeSignature: '4/4',
  mode: 'practice',
}

export function HomePage() {
  const navigate = useNavigate()
  const [health, setHealth] = useState<HealthState>({ phase: 'loading' })
  const [createProjectState, setCreateProjectState] = useState<CreateProjectState>({
    phase: 'idle',
  })
  const [formState, setFormState] = useState(initialFormState)

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreateProjectState({ phase: 'submitting' })

    const payload = {
      title: formState.title,
      bpm: formState.bpm ? Number(formState.bpm) : null,
      base_key: formState.baseKey || null,
      time_signature: formState.timeSignature || null,
      mode: formState.mode || null,
    }

    try {
      const response = await fetch(buildApiUrl('/api/projects'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorPayload = (await response.json()) as { detail?: unknown }
        throw new Error(
          typeof errorPayload.detail === 'string'
            ? errorPayload.detail
            : '프로젝트 생성에 실패했습니다.',
        )
      }

      const createdProject = (await response.json()) as Project
      navigate(`/projects/${createdProject.project_id}/studio`)
    } catch (error) {
      setCreateProjectState({
        phase: 'error',
        message:
          error instanceof Error ? error.message : '프로젝트 생성에 실패했습니다.',
      })
    }
  }

  const healthLabel =
    health.phase === 'loading'
      ? 'API 확인 중'
      : health.phase === 'ready'
        ? 'API 연결 완료'
        : 'API 미연결'

  return (
    <div className="page-shell">
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

      <section className="section section--split">
        <article className="panel form-panel">
          <p className="eyebrow">FE-01</p>
          <h2>프로젝트 생성 후 스튜디오로 진입</h2>
          <p className="panel__summary">
            이 화면은 foundation 기준의 첫 프론트엔드 티켓을 바로 확인하기 위한 최소
            시작점이다.
          </p>

          <form className="project-form" onSubmit={handleSubmit}>
            <label className="field">
              <span>프로젝트 제목</span>
              <input
                className="text-input"
                name="title"
                placeholder="예: Morning Warmup"
                value={formState.title}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                required
              />
            </label>

            <div className="field-grid">
              <label className="field">
                <span>BPM</span>
                <input
                  className="text-input"
                  name="bpm"
                  inputMode="numeric"
                  value={formState.bpm}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      bpm: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field">
                <span>조성</span>
                <input
                  className="text-input"
                  name="baseKey"
                  value={formState.baseKey}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      baseKey: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>박자</span>
                <input
                  className="text-input"
                  name="timeSignature"
                  value={formState.timeSignature}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      timeSignature: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field">
                <span>모드</span>
                <select
                  className="text-input"
                  name="mode"
                  value={formState.mode}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      mode: event.target.value,
                    }))
                  }
                >
                  <option value="practice">practice</option>
                  <option value="arrangement">arrangement</option>
                </select>
              </label>
            </div>

            {createProjectState.phase === 'error' ? (
              <p className="form-error">{createProjectState.message}</p>
            ) : null}

            <button
              className="button-primary"
              type="submit"
              disabled={createProjectState.phase === 'submitting'}
            >
              {createProjectState.phase === 'submitting'
                ? '프로젝트 생성 중...'
                : '스튜디오 열기'}
            </button>
          </form>
        </article>

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
    </div>
  )
}
