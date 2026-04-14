import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { buildApiUrl } from '../lib/api'
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
    title: '가이드 녹음',
    body: '가이드를 기준으로 여러 테이크를 녹음하고, 연습 흐름이 끊기지 않게 녹음 화면을 단순하게 유지합니다.',
  },
  {
    title: '음정 리뷰',
    body: '녹음이 끝난 뒤 정렬과 방향 음정 오차 피드백을 다시 계산해, 불안한 음을 과장 없이 또렷하게 보여줍니다.',
  },
  {
    title: '편곡 내보내기',
    body: '추출한 멜로디를 4~5성부 후보로 바꾸고, 악보 확인과 미리 듣기 뒤 연습용 파일로 내보낼 수 있습니다.',
  },
] as const

const workflowSteps = [
  {
    step: '01',
    title: '가이드 올리기',
    body: '연습 세션의 템포, 키, 가이드 트랙부터 먼저 정합니다.',
  },
  {
    step: '02',
    title: '테이크 녹음',
    body: '브라우저에서 카운트인, 메트로놈, 저장된 장치 설정으로 바로 녹음합니다.',
  },
  {
    step: '03',
    title: '약한 음 확인',
    body: '정렬 신뢰도, 음의 방향, 시작음과 sustain 차이를 확인합니다.',
  },
  {
    step: '04',
    title: '편곡 패키지 내보내기',
    body: '멜로디 초안을 다듬고 편곡 후보를 비교한 뒤 MusicXML, MIDI, 가이드 WAV를 내보냅니다.',
  },
] as const

const proofHighlights = [
  '가이드 기준 테이크 녹음, 장치 진단, 믹스다운 미리 듣기',
  '녹음 후 정렬, 3축 점수, 노트 단위 방향 음정 피드백',
  'Basic Pitch 기반 멜로디 초안 추출과 수정',
  '편곡 후보 비교, 악보 보기, 미리 듣기, 내보내기',
] as const

const nextStudioOutputs = [
  '브라우저 경고까지 함께 남기는 장치 기록 저장',
  '가이드 업로드, 테이크 녹음, 파형 미리보기',
  '녹음 후 정렬과 노트 단위 피드백',
  '멜로디 초안 추출과 편곡 후보 생성',
] as const

const waveformBars = [24, 40, 58, 72, 44, 66, 80, 55, 68, 38, 61, 82, 52, 74, 47] as const
const notePreview = ['C4', 'E4', 'G4', 'A4', 'G4', 'E4'] as const
const ambientVenuePhoto = '/photography/home-ambient-quiet-hall.jpg'

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
            error instanceof Error ? error.message : 'API 확인 중 알 수 없는 오류가 발생했습니다.',
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
            : '프로젝트를 만들지 못했습니다.',
        )
      }

      const createdProject = (await response.json()) as Project
      navigate(`/projects/${createdProject.project_id}/studio`)
    } catch (error) {
      setCreateProjectState({
        phase: 'error',
        message: error instanceof Error ? error.message : '프로젝트를 만들지 못했습니다.',
      })
    }
  }

  const healthLabel =
    health.phase === 'loading'
      ? 'API 확인 중'
      : health.phase === 'ready'
        ? 'API 연결됨'
        : 'API 연결 안 됨'

  return (
    <div className="page-shell home-page">
      <section className="home-hero">
        <div className="home-hero__inner">
          <header className="home-topbar">
            <div className="home-topbar__brand">
              <span>GigaStudy</span>
              <small>보컬 스튜디오</small>
            </div>

            <nav className="home-topbar__nav" aria-label="홈">
              <a href="#workflow">작업 흐름</a>
              <a href="#proof">핵심 화면</a>
              <a href="#project-intake">시작하기</a>
              <Link to="/ops">운영</Link>
            </nav>
          </header>

          <div className="home-hero__content">
            <div className="home-hero__copy">
              <p className="eyebrow">GigaStudy 보컬 스튜디오</p>
              <h1>녹음하고, 음정을 보고, 화음을 완성하세요.</h1>
              <p className="home-hero__lede">
                가이드 녹음, 노트 단위 피드백, 멜로디 초안 추출, 4~5성부 편곡 내보내기를
                한 흐름으로 이어주는 웹 보컬 스튜디오입니다.
              </p>

              <div className="button-row">
                <a className="button-primary" href="#project-intake">
                  연습 프로젝트 시작
                </a>
                <a className="button-secondary" href="#workflow">
                  흐름 보기
                </a>
              </div>
            </div>

            <div className="home-hero__visual" aria-label="스튜디오 미리보기">
              <div className="home-visual__header">
                <div>
                  <p className="eyebrow">스튜디오 미리보기</p>
                  <h2>녹음 후 피드백을 한 화면에서 이어서 확인합니다</h2>
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
                <span>가이드 준비 완료</span>
                <span>테이크 2 선택됨</span>
                <span>노트별 피드백</span>
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
                  <span>약한 음</span>
                  <strong>A4</strong>
                  <small>시작이 약간 높음</small>
                </div>
                <div>
                  <span>편곡</span>
                  <strong>후보 3개</strong>
                  <small>MusicXML / MIDI / 가이드 WAV</small>
                </div>
                <div>
                  <span>리뷰</span>
                  <strong>음정 86</strong>
                  <small>리듬 91 · 화음 79</small>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="home-signal-strip" aria-label="제품 특징">
        {studioSignals.map((signal) => (
          <article className="home-signal" key={signal.title}>
            <h3>{signal.title}</h3>
            <p>{signal.body}</p>
          </article>
        ))}
      </section>

      <section className="home-section" id="workflow">
        <div className="home-section__header">
          <p className="eyebrow">작업 흐름</p>
          <h2>가이드부터 악보 패키지까지, 흐름을 끊지 않고 이어집니다</h2>
          <p>
            이 제품은 한 번의 연습 흐름으로 설계했습니다. 테이크를 녹음하고, 음 상태를
            확인하고, 멜로디 초안과 화음 내보내기까지 자연스럽게 이어집니다.
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
          <p className="eyebrow">현재 구현 상태</p>
          <h2>녹음, 음정 확인, 편곡 비교를 한 스튜디오에서 다룹니다</h2>
          <p>
            현재 빌드는 가이드 녹음부터 악보 렌더링과 내보내기까지 MVP 흐름을 이미
            포함합니다. 다음 단계는 기능을 더 붙이는 것보다, 이 흐름을 더 자연스럽게
            다듬는 일입니다.
          </p>

          <ul className="home-proof__list">
            {proofHighlights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="home-proof__board" aria-label="작업 흐름 근거">
          <figure className="home-proof__photo">
            <img
              src={ambientVenuePhoto}
              alt="따뜻한 조명과 의자가 정돈된 조용한 연습 공간"
            />
            <figcaption>
              차분한 깊이감, 한 곳에 모이는 시선, 절제된 조명. 연습을 시작할 때 제품도
              이런 분위기로 느껴져야 합니다.
            </figcaption>
          </figure>

          <article className="home-proof__row">
            <span>녹음 레인</span>
            <strong>가이드 + 멀티 테이크</strong>
            <small>카운트인, 메트로놈, 음소거, 솔로, 볼륨, 파형 미리보기</small>
          </article>

          <article className="home-proof__row">
            <span>교정 레인</span>
            <strong>방향 음정 오차 기반 피드백</strong>
            <small>시작음, 유지음, 타이밍, 신뢰도, 화음 기준 피드백</small>
          </article>

          <article className="home-proof__row">
            <span>편곡 레인</span>
            <strong>수정 가능한 악보 패키지</strong>
            <small>멜로디 초안, 후보 비교, 미리 듣기, MusicXML, MIDI, 가이드 WAV</small>
          </article>
        </div>
      </section>

      <section className="home-section home-intake" id="project-intake">
        <div className="home-section__header">
          <p className="eyebrow">연습 프로젝트 시작</p>
          <h2>세션 틀만 정하고 바로 스튜디오 콘솔로 들어갑니다</h2>
          <p>
            입력은 짧게 끝냅니다. 여기서는 음악적 기본값만 잡고, 실제 작업은 녹음,
            분석, 편곡이 함께 있는 스튜디오 안에서 진행합니다.
          </p>
        </div>

        <div className="home-intake__layout">
          <article className="panel home-intake__panel">
            <form className="project-form" onSubmit={handleSubmit}>
              <label className="field">
                <span>프로젝트 이름</span>
                <input
                  data-testid="project-title-input"
                  className="text-input"
                  name="title"
                  placeholder="아침 워밍업 가이드"
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
                  <span>템포(BPM)</span>
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
                  <span>기준 키</span>
                  <input
                    data-testid="base-key-input"
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
                  <span>작업 목적</span>
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
                    <option value="practice">기본 연습</option>
                    <option value="arrangement">편곡 준비</option>
                  </select>
                </label>
              </div>

              {createProjectState.phase === 'error' ? (
                <p className="form-error">{createProjectState.message}</p>
              ) : null}

              <button
                data-testid="open-studio-button"
                className="button-primary"
                type="submit"
                disabled={createProjectState.phase === 'submitting'}
              >
                {createProjectState.phase === 'submitting'
                  ? '프로젝트 만드는 중...'
                  : '스튜디오 열기'}
              </button>
            </form>
          </article>

          <aside className="home-intake__aside">
            <article className="panel home-intake__support">
              <p className="eyebrow">다음 단계</p>
              <h3>현재 빌드에 이미 연결된 스튜디오 기능</h3>
              <ul className="home-output-list">
                {nextStudioOutputs.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              <div className="button-row">
                <Link className="button-secondary" to="/ops">
                  운영 화면 열기
                </Link>
              </div>
            </article>

            <article className="status-card home-status-card" aria-label="API 상태">
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
                <p className="status-card__caption">서비스 연결 상태</p>
              </div>

              {health.phase === 'error' ? (
                <p className="status-card__error">
                  지금은 서비스 연결을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요. 메시지:
                  {' '}{health.message}
                </p>
              ) : (
                <p className="status-card__hint">
                  연결만 확인되면 이 화면에서 추가 준비 없이 바로 스튜디오로 들어갈 수 있습니다.
                </p>
              )}
            </article>
          </aside>
        </div>
      </section>
    </div>
  )
}
