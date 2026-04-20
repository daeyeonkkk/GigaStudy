import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { createStudio, listStudios, readFileAsDataUrl } from '../lib/api'
import type { StudioListItem } from '../types/studio'
import './LaunchPage.css'

type SubmitState =
  | { phase: 'idle' }
  | { phase: 'submitting'; label: string }
  | { phase: 'error'; message: string }

function detectSourceKind(file: File): 'score' | 'music' {
  const name = file.name.toLowerCase()
  if (
    name.endsWith('.musicxml') ||
    name.endsWith('.mxl') ||
    name.endsWith('.xml') ||
    name.endsWith('.pdf') ||
    name.endsWith('.mid') ||
    name.endsWith('.midi')
  ) {
    return 'score'
  }
  return 'music'
}

export function LaunchPage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [bpm, setBpm] = useState('92')
  const [timeSignatureNumerator, setTimeSignatureNumerator] = useState('4')
  const [timeSignatureDenominator, setTimeSignatureDenominator] = useState('4')
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [sourceKindOverride, setSourceKindOverride] = useState<'auto' | 'score' | 'music'>('auto')
  const [submitState, setSubmitState] = useState<SubmitState>({ phase: 'idle' })
  const [recentStudios, setRecentStudios] = useState<StudioListItem[]>([])
  const [recentMessage, setRecentMessage] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false

    listStudios()
      .then((items) => {
        if (!ignore) {
          setRecentStudios(items.slice(0, 4))
        }
      })
      .catch(() => {
        if (!ignore) {
          setRecentMessage('API 서버에 연결되면 최근 스튜디오가 여기에 표시됩니다.')
        }
      })

    return () => {
      ignore = true
    }
  }, [])

  const canSubmit = useMemo(
    () =>
      title.trim().length > 0 &&
      Number.isFinite(Number(bpm)) &&
      Number.isFinite(Number(timeSignatureNumerator)) &&
      Number.isFinite(Number(timeSignatureDenominator)),
    [bpm, timeSignatureDenominator, timeSignatureNumerator, title],
  )

  async function startBlank() {
    if (!canSubmit) {
      setSubmitState({ phase: 'error', message: '프로젝트명과 BPM을 먼저 입력하세요.' })
      return
    }

    setSubmitState({ phase: 'submitting', label: '새 스튜디오 생성 중' })
    try {
      const studio = await createStudio({
        title: title.trim(),
        bpm: Number(bpm),
        time_signature_numerator: Number(timeSignatureNumerator),
        time_signature_denominator: Number(timeSignatureDenominator),
        start_mode: 'blank',
      })
      navigate(`/studios/${studio.studio_id}`)
    } catch (error) {
      setSubmitState({
        phase: 'error',
        message: error instanceof Error ? error.message : '스튜디오를 만들지 못했습니다.',
      })
    }
  }

  async function uploadAndStart() {
    if (!canSubmit) {
      setSubmitState({ phase: 'error', message: '프로젝트명과 BPM을 먼저 입력하세요.' })
      return
    }
    if (!sourceFile) {
      setSubmitState({ phase: 'error', message: '악보나 음악 파일을 선택하세요.' })
      return
    }

    const sourceKind = sourceKindOverride === 'auto' ? detectSourceKind(sourceFile) : sourceKindOverride
    setSubmitState({ phase: 'submitting', label: '업로드 분석 중' })
    try {
      const sourceContentBase64 = await readFileAsDataUrl(sourceFile)
      const studio = await createStudio({
        title: title.trim(),
        bpm: Number(bpm),
        time_signature_numerator: Number(timeSignatureNumerator),
        time_signature_denominator: Number(timeSignatureDenominator),
        start_mode: 'upload',
        source_kind: sourceKind,
        source_filename: sourceFile.name,
        source_content_base64: sourceContentBase64,
      })
      navigate(`/studios/${studio.studio_id}`)
    } catch (error) {
      setSubmitState({
        phase: 'error',
        message: error instanceof Error ? error.message : '업로드 후 시작하지 못했습니다.',
      })
    }
  }

  return (
    <main className="app-shell launch-page">
      <section className="launch-composer" aria-label="GigaStudy studio launcher">
        <header className="launch-titlebar">
          <span className="launch-app-mark">GS</span>
          <span>GigaStudy - New Studio</span>
        </header>

        <nav className="launch-menubar" aria-label="홈 메뉴">
          <span>File</span>
          <span>View</span>
          <span>Play</span>
          <span>Tools</span>
          <span>Help</span>
        </nav>

        <div className="launch-toolbar" aria-label="스튜디오 생성 도구">
          <button className="launch-tool" type="button" onClick={() => void uploadAndStart()}>
            <span aria-hidden="true">↥</span>
            Upload
          </button>
          <button className="launch-tool" type="button" onClick={() => void startBlank()}>
            <span aria-hidden="true">＋</span>
            New
          </button>
          <span className="launch-tool launch-tool--status">6 tracks · 0.01s sync</span>
        </div>

        <div className="launch-document">
          <section className="launch-score-preview" aria-label="빈 6트랙 악보 미리보기">
            <div className="launch-score-title">
              <strong>GigaStudy</strong>
              <span>Six-track a cappella studio</span>
            </div>
            {['Soprano', 'Alto', 'Tenor', 'Baritone', 'Bass', 'Percussion'].map((track) => (
              <div className="launch-staff-row" key={track}>
                <span>{track}</span>
                <div aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            ))}
          </section>

          <section className="launch-create" aria-label="새 스튜디오 만들기">
            <div className="launch-create__header">
              <p className="eyebrow">Document setup</p>
              <h1>새 스튜디오</h1>
            </div>

            <div className="launch-create__form">
              <label className="launch-field">
                <span>프로젝트명</span>
                <input
                  data-testid="studio-title-input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="예: 봄 공연 SATB 연습"
                />
              </label>

              <label className="launch-field">
                <span>BPM</span>
                <input
                  data-testid="studio-bpm-input"
                  inputMode="numeric"
                  value={bpm}
                  onChange={(event) => setBpm(event.target.value)}
                />
              </label>

              <div className="launch-field launch-field--time-signature">
                <span>Time Signature</span>
                <input
                  aria-label="time signature numerator"
                  data-testid="studio-time-signature-numerator"
                  inputMode="numeric"
                  value={timeSignatureNumerator}
                  onChange={(event) => setTimeSignatureNumerator(event.target.value)}
                />
                <select
                  aria-label="time signature denominator"
                  data-testid="studio-time-signature-denominator"
                  value={timeSignatureDenominator}
                  onChange={(event) => setTimeSignatureDenominator(event.target.value)}
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="4">4</option>
                  <option value="8">8</option>
                  <option value="16">16</option>
                  <option value="32">32</option>
                </select>
              </div>

              <label className="launch-field">
                <span>악보 또는 음악</span>
                <input
                  data-testid="studio-source-input"
                  type="file"
                  accept=".wav,.mp3,.m4a,.ogg,.flac,.mid,.midi,.musicxml,.mxl,.xml,.pdf"
                  onChange={(event) => setSourceFile(event.target.files?.[0] ?? null)}
                />
              </label>

              <label className="launch-field">
                <span>업로드 해석</span>
                <select
                  value={sourceKindOverride}
                  onChange={(event) =>
                    setSourceKindOverride(event.target.value as 'auto' | 'score' | 'music')
                  }
                >
                  <option value="auto">자동 판단</option>
                  <option value="score">악보</option>
                  <option value="music">음악</option>
                </select>
              </label>
            </div>

            <div className="launch-actions">
              <button
                data-testid="upload-and-start-button"
                className="app-button"
                type="button"
                disabled={submitState.phase === 'submitting'}
                onClick={() => void uploadAndStart()}
              >
                업로드 후 시작
              </button>
              <button
                data-testid="start-blank-button"
                className="app-button app-button--secondary"
                type="button"
                disabled={submitState.phase === 'submitting'}
                onClick={() => void startBlank()}
              >
                새로 시작
              </button>
            </div>

            {submitState.phase === 'submitting' ? (
              <p className="launch-message" role="status">
                {submitState.label}...
              </p>
            ) : null}
            {submitState.phase === 'error' ? (
              <p className="launch-error" role="alert">
                {submitState.message}
              </p>
            ) : null}
          </section>
        </div>

        <footer className="launch-statusbar">
          <span>Ready</span>
          <span>Tracks 1-6</span>
          <span>Score / Music / Blank</span>
        </footer>
      </section>

      {recentStudios.length > 0 || recentMessage ? (
        <section className="launch-recent" aria-label="최근 스튜디오">
          <div>
            <p className="eyebrow">최근 스튜디오</p>
            {recentMessage ? <p>{recentMessage}</p> : null}
          </div>
          {recentStudios.map((studio) => (
            <button
              key={studio.studio_id}
              className="launch-recent__item"
              type="button"
              onClick={() => navigate(`/studios/${studio.studio_id}`)}
            >
              <strong>{studio.title}</strong>
              <span>
                {studio.bpm} BPM · {studio.time_signature_numerator ?? 4}/{studio.time_signature_denominator ?? 4} · 등록{' '}
                {studio.registered_track_count}/6 · 리포트 {studio.report_count}
              </span>
            </button>
          ))}
        </section>
      ) : null}
    </main>
  )
}
