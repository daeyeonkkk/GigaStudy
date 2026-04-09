import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

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

const studioSignals = [
  {
    title: 'Guided recording',
    body: 'Set the guide, capture multiple takes, and keep the transport focused on rehearsal instead of setup overhead.',
  },
  {
    title: 'Note-level review',
    body: 'Rerun alignment and signed-cents feedback after the take so weak notes are visible without pretending to be real-time certainty.',
  },
  {
    title: 'Arrangement export',
    body: 'Turn the extracted melody into editable 4 to 5-part candidates, score them, preview them, and export the practice package.',
  },
] as const

const workflowSteps = [
  {
    step: '01',
    title: 'Upload a guide',
    body: 'Start with the tempo, key, and guide track that define the practice session.',
  },
  {
    step: '02',
    title: 'Record the take',
    body: 'Capture takes in the browser with count-in, metronome, and saved device settings.',
  },
  {
    step: '03',
    title: 'Review weak notes',
    body: 'Inspect alignment confidence, note direction, and attack versus sustain behavior.',
  },
  {
    step: '04',
    title: 'Export the harmony stack',
    body: 'Edit the melody draft, compare arrangement candidates, and export MusicXML, MIDI, and guide WAV.',
  },
] as const

const proofHighlights = [
  'Guide-backed take recording with device diagnostics and mixdown preview',
  'Post-recording alignment, 3-axis scoring, and note-level signed-cents feedback',
  'Editable melody draft extraction through Basic Pitch',
  'Arrangement candidate compare with score rendering, playback, and export',
] as const

const nextStudioOutputs = [
  'DeviceProfile capture with saved browser capability warnings',
  'Guide upload, take recording, and waveform preview',
  'Post-recording alignment with note-level feedback',
  'Melody draft extraction and arrangement candidate generation',
] as const

const waveformBars = [24, 40, 58, 72, 44, 66, 80, 55, 68, 38, 61, 82, 52, 74, 47] as const
const notePreview = ['C4', 'E4', 'G4', 'A4', 'G4', 'E4'] as const

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
    <div className="page-shell home-page">
      <section className="home-hero">
        <div className="home-hero__inner">
          <header className="home-topbar">
            <div className="home-topbar__brand">
              <span>GigaStudy</span>
              <small>Vocal Studio</small>
            </div>

            <nav className="home-topbar__nav" aria-label="home">
              <a href="#workflow">Workflow</a>
              <a href="#proof">Review</a>
              <a href="#project-intake">Start</a>
              <Link to="/ops">Ops</Link>
            </nav>
          </header>

          <div className="home-hero__content">
            <div className="home-hero__copy">
              <p className="eyebrow">GigaStudy Vocal Studio</p>
              <h1>Record the take. Review the pitch. Build the harmony.</h1>
              <p className="home-hero__lede">
                A web studio for guided vocal practice, note-level feedback, editable
                melody draft extraction, and 4 to 5-part arrangement export.
              </p>

              <div className="button-row">
                <a className="button-primary" href="#project-intake">
                  Start a practice project
                </a>
                <a className="button-secondary" href="#workflow">
                  See the workflow
                </a>
              </div>
            </div>

            <div className="home-hero__visual" aria-label="studio preview">
              <div className="home-visual__header">
                <div>
                  <p className="eyebrow">Studio Preview</p>
                  <h2>Post-recording feedback in one working surface</h2>
                </div>
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
              </div>

              <div className="home-visual__transport">
                <span>Guide ready</span>
                <span>Take 2 selected</span>
                <span>Pitch mode: note-level</span>
              </div>

              <div className="home-visual__waveform">
                {waveformBars.map((barHeight, index) => (
                  <span
                    className="home-visual__bar"
                    key={`${barHeight}-${index}`}
                    style={{ height: `${barHeight}%` }}
                  />
                ))}
              </div>

              <div className="home-visual__notes">
                {notePreview.map((note, index) => (
                  <span
                    className={`home-visual__note ${
                      index === 3 ? 'home-visual__note--alert' : ''
                    }`}
                    key={`${note}-${index}`}
                  >
                    {note}
                  </span>
                ))}
              </div>

              <div className="home-visual__readout">
                <div>
                  <span>Weak note</span>
                  <strong>A4</strong>
                  <small>Attack +24c sharp</small>
                </div>
                <div>
                  <span>Arrangement</span>
                  <strong>3 candidates</strong>
                  <small>MusicXML / MIDI / guide WAV</small>
                </div>
                <div>
                  <span>Review</span>
                  <strong>Pitch 86</strong>
                  <small>Rhythm 91 · Harmony 79</small>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="home-signal-strip" aria-label="product signals">
        {studioSignals.map((signal) => (
          <article className="home-signal" key={signal.title}>
            <h3>{signal.title}</h3>
            <p>{signal.body}</p>
          </article>
        ))}
      </section>

      <section className="home-section" id="workflow">
        <div className="home-section__header">
          <p className="eyebrow">Workflow</p>
          <h2>Move from guide track to score package without leaving the studio flow</h2>
          <p>
            The product is designed as one rehearsal journey: capture the take, inspect the
            note behavior, then keep going into melody draft and harmony export.
          </p>
        </div>

        <ol className="home-workflow">
          {workflowSteps.map((step) => (
            <li className="home-step" key={step.step}>
              <span className="home-step__index">{step.step}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="home-section home-proof" id="proof">
        <div className="home-proof__copy">
          <p className="eyebrow">Product Snapshot</p>
          <h2>One studio for recording, note correction, and arrangement compare</h2>
          <p>
            The current build already covers the MVP arc from guided take recording through
            score rendering and export. The next visual refactor is about making that flow
            feel unified, not inventing a new product surface.
          </p>

          <ul className="home-proof__list">
            {proofHighlights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="home-proof__board" aria-label="workflow proof">
          <article className="home-proof__row">
            <span>Recording lane</span>
            <strong>Guide + multi-take transport</strong>
            <small>Count-in, metronome, mute, solo, volume, and waveform preview</small>
          </article>

          <article className="home-proof__row">
            <span>Correction lane</span>
            <strong>Signed-cents note feedback</strong>
            <small>Attack, sustain, timing, confidence, and chord-aware harmony mode</small>
          </article>

          <article className="home-proof__row">
            <span>Arrangement lane</span>
            <strong>Editable score package</strong>
            <small>Melody draft, candidate compare, playback, MusicXML, MIDI, and guide WAV</small>
          </article>
        </div>
      </section>

      <section className="home-section home-intake" id="project-intake">
        <div className="home-section__header">
          <p className="eyebrow">Start A Practice Project</p>
          <h2>Set the session shell, then step straight into the studio console</h2>
          <p>
            Keep the intake small. Capture the musical frame here, then do the actual work
            inside the studio where recording, analysis, and arrangement live together.
          </p>
        </div>

        <div className="home-intake__layout">
          <article className="panel home-intake__panel">
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

          <aside className="home-intake__aside">
            <article className="panel home-intake__support">
              <p className="eyebrow">What Opens Next</p>
              <h3>Studio capabilities already wired into the build</h3>
              <ul className="home-output-list">
                {nextStudioOutputs.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              <div className="button-row">
                <Link className="button-secondary" to="/ops">
                  Open ops overview
                </Link>
              </div>
            </article>

            <article className="status-card home-status-card" aria-label="api status">
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
                  When the API is up, this screen can move straight from intake into the
                  studio without extra setup steps.
                </p>
              )}
            </article>
          </aside>
        </div>
      </section>
    </div>
  )
}
