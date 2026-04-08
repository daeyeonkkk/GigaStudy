import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { currentLaneTickets, priorityCards } from '../data/phase1'
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
            error instanceof Error ? error.message : 'An unknown API error occurred.',
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
            : 'Project creation failed.',
        )
      }

      const createdProject = (await response.json()) as Project
      navigate(`/projects/${createdProject.project_id}/studio`)
    } catch (error) {
      setCreateProjectState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Project creation failed.',
      })
    }
  }

  const healthLabel =
    health.phase === 'loading'
      ? 'Checking API'
      : health.phase === 'ready'
        ? 'API connected'
        : 'API offline'

  return (
    <div className="page-shell">
      <section className="hero">
        <div className="hero__copy">
          <p className="eyebrow">GigaStudy Environment Track</p>
          <h1>Turn seeded browser coverage into real environment validation.</h1>
          <p className="hero__summary">
            This workspace now follows the PROJECT_FOUNDATION environment-validation lane:
            keep the core studio flow stable while making browser and hardware variability visible,
            exportable, and ready for native Safari and real-device checks.
          </p>

          <div className="chip-row" aria-label="current scope">
            <span className="chip">React 19 + Vite</span>
            <span className="chip">FastAPI</span>
            <span className="chip">Ops diagnostics</span>
            <span className="chip">Hardware validation</span>
          </div>

          <div className="button-row">
            <Link className="button-secondary" to="/ops">
              Open ops overview
            </Link>
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
            <p className="status-card__caption">Local API check</p>
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
              The API health check failed. Start the FastAPI server, then refresh this
              page. Message: {health.message}
            </p>
          ) : (
            <p className="status-card__hint">
              When both apps are running, this card flips to connected immediately.
            </p>
          )}
        </aside>
      </section>

      <section className="section section--split">
        <article className="panel form-panel">
          <p className="eyebrow">FE-01</p>
          <h2>Create a project and enter the studio</h2>
          <p className="panel__summary">
            The entry flow stays intentionally small: capture core musical metadata,
            then move straight into the studio where DeviceProfiles, recordings, and
            environment diagnostics can be exercised.
          </p>

          <form className="project-form" onSubmit={handleSubmit}>
            <label className="field">
              <span>Project title</span>
              <input
                className="text-input"
                name="title"
                placeholder="Morning warmup guide"
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
                <span>Base key</span>
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
                <span>Time signature</span>
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
                <span>Mode</span>
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
                ? 'Creating project...'
                : 'Open studio'}
            </button>
          </form>
        </article>

        <article className="panel">
          <p className="eyebrow">Current Lane</p>
          <h2>Environment-validation tickets in motion</h2>
          <ul className="ticket-list">
            {currentLaneTickets.map((ticket) => (
              <li key={ticket}>
                <strong>{ticket}</strong>
                <span>Active checkpoint from PROJECT_FOUNDATION</span>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="section">
        <div className="section__header">
          <p className="eyebrow">Release Gate</p>
          <h2>What this repo is tightening right now</h2>
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
