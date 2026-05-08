import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  createStudio,
  createStudioUploadTarget,
  deactivateStudio,
  listStudios,
  putDirectUpload,
  readFileAsDataUrl,
  setOwnerTokenFromStudioPassword,
} from '../lib/api'
import { getFileExtension } from '../lib/audio'
import { getStudioListRetryDelayMs } from '../lib/studioListRetry'
import type { Studio, StudioListItem } from '../types/studio'
import './LaunchPage.css'

type SubmitState =
  | { phase: 'idle' }
  | { phase: 'submitting'; label: string }
  | { phase: 'error'; message: string }

type PreparedLaunchSource = {
  filename: string
  blob: Blob
  contentType: string
  contentBase64?: string
}

const DOCUMENT_SOURCE_EXTENSIONS = new Set([
  '.musicxml',
  '.mxl',
  '.xml',
  '.pdf',
  '.mid',
  '.midi',
])
const SUPPORTED_SOURCE_ACCEPT = [...DOCUMENT_SOURCE_EXTENSIONS].join(',')
const VALID_DENOMINATORS = new Set([1, 2, 4, 8, 16, 32])

function isSupportedSourceFile(file: File): boolean {
  const extension = getFileExtension(file.name)
  return DOCUMENT_SOURCE_EXTENSIONS.has(extension)
}

function parseInteger(value: string): number | null {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) {
    return null
  }
  const parsed = Number.parseInt(normalized, 10)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function createClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function LaunchPage() {
  const navigate = useNavigate()
  const sourceInputRef = useRef<HTMLInputElement | null>(null)
  const creationRequestRef = useRef<{ fingerprint: string; id: string } | null>(null)
  const [title, setTitle] = useState('')
  const [studioPassword, setStudioPassword] = useState('')
  const [bpm, setBpm] = useState('92')
  const [timeSignatureNumerator, setTimeSignatureNumerator] = useState('4')
  const [timeSignatureDenominator, setTimeSignatureDenominator] = useState('4')
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [sourceInputKey, setSourceInputKey] = useState(0)
  const [submitState, setSubmitState] = useState<SubmitState>({ phase: 'idle' })
  const [recentStudios, setRecentStudios] = useState<StudioListItem[]>([])
  const [recentMessage, setRecentMessage] = useState<string | null>('스튜디오 목록을 불러오는 중입니다.')
  const [recentReloadKey, setRecentReloadKey] = useState(0)
  const [selectedStudioId, setSelectedStudioId] = useState<string | null>(null)
  const [selectedStudioPassword, setSelectedStudioPassword] = useState('')
  const [selectedStudioMessage, setSelectedStudioMessage] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    function clearRetryTimer() {
      if (retryTimer !== null) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
    }

    function loadRecentStudios(attemptIndex: number) {
      if (attemptIndex === 0) {
        setRecentMessage('스튜디오 목록을 불러오는 중입니다.')
      }
      listStudios(12, 0)
        .then((items) => {
          if (!ignore) {
            setRecentStudios(items)
            setRecentMessage(items.length === 0 ? '아직 만든 스튜디오가 없습니다.' : null)
          }
        })
        .catch(() => {
          if (ignore) {
            return
          }
          const delayMs = getStudioListRetryDelayMs(attemptIndex)
          setRecentMessage(
            attemptIndex <= 1
              ? '스튜디오 목록 확인이 늦어지고 있습니다. 잠시 뒤 다시 확인합니다.'
              : `${Math.round(delayMs / 1000)}초 뒤 스튜디오 목록을 다시 확인합니다.`,
          )
          clearRetryTimer()
          retryTimer = setTimeout(() => loadRecentStudios(attemptIndex + 1), delayMs)
        })
    }

    loadRecentStudios(0)

    return () => {
      ignore = true
      clearRetryTimer()
    }
  }, [recentReloadKey])

  function refreshRecentStudios() {
    setRecentMessage('스튜디오 목록을 다시 확인합니다.')
    setRecentReloadKey((currentKey) => currentKey + 1)
  }

  const normalizedTitle = title.trim()
  const parsedBpm = useMemo(() => parseInteger(bpm), [bpm])
  const parsedNumerator = useMemo(() => parseInteger(timeSignatureNumerator), [timeSignatureNumerator])
  const parsedDenominator = useMemo(
    () => parseInteger(timeSignatureDenominator),
    [timeSignatureDenominator],
  )
  const hasProjectTitle = normalizedTitle.length > 0
  const hasStudioPassword = studioPassword.trim().length > 0
  const hasValidBlankSetup =
    parsedBpm !== null &&
    parsedBpm >= 40 &&
    parsedBpm <= 240 &&
    parsedNumerator !== null &&
    parsedNumerator >= 1 &&
    parsedNumerator <= 32 &&
    parsedDenominator !== null &&
    VALID_DENOMINATORS.has(parsedDenominator)
  const canStartBlank = sourceFile === null && hasProjectTitle && hasStudioPassword && hasValidBlankSetup
  const canUploadStart = sourceFile !== null && hasProjectTitle && hasStudioPassword
  const selectedStudio = recentStudios.find((studio) => studio.studio_id === selectedStudioId) ?? null

  function clearSourceFile() {
    setSourceFile(null)
    setSubmitState({ phase: 'idle' })
    setSourceInputKey((currentKey) => currentKey + 1)
  }

  function getCreationRequestId(fingerprint: string): string {
    if (creationRequestRef.current?.fingerprint !== fingerprint) {
      creationRequestRef.current = {
        fingerprint,
        id: createClientRequestId(),
      }
    }
    return creationRequestRef.current.id
  }

  function blankCreationFingerprint(): string {
    return [
      'blank',
      normalizedTitle,
      parsedBpm ?? '',
      parsedNumerator ?? '',
      parsedDenominator ?? '',
    ].join('|')
  }

  function uploadCreationFingerprint(file: File): string {
    return [
      'upload',
      normalizedTitle,
      file.name,
      file.size,
      file.lastModified,
    ].join('|')
  }

  async function startBlank() {
    if (submitState.phase === 'submitting') {
      return
    }
    if (sourceFile) {
      setSubmitState({ phase: 'error', message: '파일 선택을 해제한 뒤 새 스튜디오를 시작할 수 있습니다.' })
      return
    }
    if (!hasProjectTitle) {
      setSubmitState({ phase: 'error', message: '프로젝트명을 먼저 입력하세요.' })
      return
    }
    if (!hasStudioPassword) {
      setSubmitState({ phase: 'error', message: '스튜디오 비밀번호를 입력하세요.' })
      return
    }
    if (!hasValidBlankSetup || parsedBpm === null || parsedNumerator === null || parsedDenominator === null) {
      setSubmitState({
        phase: 'error',
        message: 'BPM은 40-240, 박자는 1-32 / 1,2,4,8,16,32 중 하나로 입력하세요.',
      })
      return
    }

    setSubmitState({ phase: 'submitting', label: '새 스튜디오 생성 중' })
    try {
      await setOwnerTokenFromStudioPassword(studioPassword)
      const clientRequestId = getCreationRequestId(blankCreationFingerprint())
      const studio = await createStudio({
        title: normalizedTitle,
        client_request_id: clientRequestId,
        bpm: parsedBpm,
        time_signature_numerator: parsedNumerator,
        time_signature_denominator: parsedDenominator,
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
    if (submitState.phase === 'submitting') {
      return
    }
    if (!sourceFile) {
      setSubmitState({ phase: 'error', message: 'PDF, MIDI, MusicXML 파일을 선택하세요.' })
      return
    }
    if (!hasProjectTitle) {
      setSubmitState({ phase: 'error', message: '프로젝트명을 먼저 입력하세요.' })
      return
    }
    if (!hasStudioPassword) {
      setSubmitState({ phase: 'error', message: '스튜디오 비밀번호를 입력하세요.' })
      return
    }

    setSubmitState({ phase: 'submitting', label: '악보 파일 업로드와 분석 대기열 준비 중' })
    try {
      await setOwnerTokenFromStudioPassword(studioPassword)
      const clientRequestId = getCreationRequestId(uploadCreationFingerprint(sourceFile))
      const preparedSource: PreparedLaunchSource = {
        filename: sourceFile.name,
        blob: sourceFile,
        contentType: sourceFile.type || 'application/octet-stream',
      }
      let studio: Studio | null = null
      let uploadedAssetPath: string | null = null
      try {
        const uploadTarget = await createStudioUploadTarget({
          source_kind: 'document',
          filename: preparedSource.filename,
          size_bytes: preparedSource.blob.size,
          content_type: preparedSource.contentType,
        })
        await putDirectUpload(uploadTarget, preparedSource.blob)
        uploadedAssetPath = uploadTarget.asset_path
      } catch {
        setSubmitState({ phase: 'submitting', label: '다른 방식으로 파일을 보내는 중' })
        const contentBase64 = preparedSource.contentBase64 ?? (await readFileAsDataUrl(sourceFile))
        studio = await createStudio({
          title: normalizedTitle,
          client_request_id: clientRequestId,
          start_mode: 'upload',
          source_kind: 'document',
          source_filename: preparedSource.filename,
          source_content_base64: contentBase64,
        })
      }
      if (uploadedAssetPath) {
        studio = await createStudio({
          title: normalizedTitle,
          client_request_id: clientRequestId,
          start_mode: 'upload',
          source_kind: 'document',
          source_filename: preparedSource.filename,
          source_asset_path: uploadedAssetPath,
        })
      }
      if (!studio) {
        throw new Error('악보 파일로 스튜디오를 시작하지 못했습니다.')
      }
      navigate(`/studios/${studio.studio_id}`)
    } catch (error) {
      setSubmitState({
        phase: 'error',
        message: error instanceof Error ? error.message : '악보 파일로 시작하지 못했습니다.',
      })
    }
  }

  function selectStudioFromList(studio: StudioListItem) {
    setSelectedStudioId(studio.studio_id)
    setSelectedStudioPassword('')
    setSelectedStudioMessage(null)
  }

  async function enterSelectedStudio() {
    if (!selectedStudio) {
      return
    }
    if (!selectedStudioPassword.trim()) {
      setSelectedStudioMessage('비밀번호를 입력하세요.')
      return
    }
    await setOwnerTokenFromStudioPassword(selectedStudioPassword)
    navigate(`/studios/${selectedStudio.studio_id}`)
  }

  async function deactivateSelectedStudio() {
    if (!selectedStudio) {
      return
    }
    if (!selectedStudioPassword.trim()) {
      setSelectedStudioMessage('비밀번호를 입력하세요.')
      return
    }
    if (!window.confirm(`${selectedStudio.title} 스튜디오를 목록에서 삭제할까요?`)) {
      return
    }
    try {
      setSelectedStudioMessage('삭제 중입니다...')
      await setOwnerTokenFromStudioPassword(selectedStudioPassword)
      await deactivateStudio(selectedStudio.studio_id)
      setRecentStudios((items) => items.filter((studio) => studio.studio_id !== selectedStudio.studio_id))
      setSelectedStudioId(null)
      setSelectedStudioPassword('')
      setSelectedStudioMessage('목록에서 삭제했습니다.')
    } catch (error) {
      setSelectedStudioMessage(error instanceof Error ? error.message : '스튜디오를 삭제하지 못했습니다.')
    }
  }

  return (
    <main className="app-shell launch-page">
      <section className="launch-composer" aria-label="GigaStudy 스튜디오 시작">
        <header className="launch-titlebar">
          <span className="launch-app-mark">GS</span>
          <span>GigaStudy - 새 스튜디오</span>
        </header>

        <nav className="launch-menubar" aria-label="상단 메뉴">
          <button
            className="launch-menubar__item"
            disabled={submitState.phase === 'submitting'}
            title="PDF, MIDI, MusicXML 파일 선택"
            type="button"
            onClick={() => sourceInputRef.current?.click()}
          >
            파일
          </button>
          <button className="launch-menubar__item" disabled title="보기 메뉴는 준비 중입니다." type="button">
            보기
          </button>
          <button className="launch-menubar__item" disabled title="스튜디오 안에서 사용할 수 있습니다." type="button">
            재생
          </button>
          <button className="launch-menubar__item" disabled title="도구 메뉴는 준비 중입니다." type="button">
            도구
          </button>
          <button className="launch-menubar__item" disabled title="도움말 문서는 준비 중입니다." type="button">
            도움말
          </button>
        </nav>

        <div className="launch-toolbar" aria-label="스튜디오 생성 도구">
          <button className="launch-tool" type="button" onClick={() => sourceInputRef.current?.click()}>
            <span aria-hidden="true">악보 파일</span>
          </button>
          <button
            className="launch-tool"
            type="button"
            disabled={Boolean(sourceFile) || submitState.phase === 'submitting'}
            onClick={() => void startBlank()}
          >
            <span aria-hidden="true">새로</span>
          </button>
          <span className="launch-tool launch-tool--status">6트랙 | 0.01초 싱크</span>
        </div>

        <div className="launch-document">
          <section className="launch-arrange-preview" aria-label="빈 6트랙 편집 미리보기">
            <div className="launch-arrange-title">
              <strong>GigaStudy</strong>
              <span>6트랙 아카펠라 스튜디오</span>
            </div>
            {['소프라노', '알토', '테너', '바리톤', '베이스', '퍼커션'].map((track) => (
              <div className="launch-region-row" key={track}>
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

          <section className="launch-create" aria-label="새 스튜디오 만들기" aria-busy={submitState.phase === 'submitting'}>
            <div className="launch-create__header">
              <p className="eyebrow">스튜디오 설정</p>
              <h1>새 스튜디오</h1>
            </div>

            <div className="launch-create__form">
              <label className="launch-field">
                <span>프로젝트명</span>
                <input
                  data-testid="studio-title-input"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value)
                    if (submitState.phase === 'error') {
                      setSubmitState({ phase: 'idle' })
                    }
                  }}
                  placeholder="봄 공연 SATB 연습"
                />
              </label>

              <label className="launch-field">
                <span>비밀번호</span>
                <input
                  data-testid="studio-password-input"
                  type="password"
                  value={studioPassword}
                  onChange={(event) => {
                    setStudioPassword(event.target.value)
                    if (submitState.phase === 'error') {
                      setSubmitState({ phase: 'idle' })
                    }
                  }}
                  placeholder="스튜디오 입장과 삭제에 사용"
                />
              </label>

              {sourceFile === null ? (
                <>
                  <label className="launch-field">
                    <span>템포</span>
                    <input
                      data-testid="studio-bpm-input"
                      inputMode="numeric"
                      value={bpm}
                      onChange={(event) => {
                        setBpm(event.target.value)
                        if (submitState.phase === 'error') {
                          setSubmitState({ phase: 'idle' })
                        }
                      }}
                    />
                  </label>

                  <div className="launch-field launch-field--time-signature">
                    <span>박자표</span>
                    <input
                      aria-label="박자표 분자"
                      data-testid="studio-time-signature-numerator"
                      inputMode="numeric"
                      value={timeSignatureNumerator}
                      onChange={(event) => {
                        setTimeSignatureNumerator(event.target.value)
                        if (submitState.phase === 'error') {
                          setSubmitState({ phase: 'idle' })
                        }
                      }}
                    />
                    <select
                      aria-label="박자표 분모"
                      data-testid="studio-time-signature-denominator"
                      value={timeSignatureDenominator}
                      onChange={(event) => {
                        setTimeSignatureDenominator(event.target.value)
                        if (submitState.phase === 'error') {
                          setSubmitState({ phase: 'idle' })
                        }
                      }}
                    >
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="4">4</option>
                      <option value="8">8</option>
                      <option value="16">16</option>
                      <option value="32">32</option>
                    </select>
                  </div>
                </>
              ) : null}

              <label className="launch-field">
                <span>PDF/MIDI/MusicXML</span>
                <input
                  key={sourceInputKey}
                  ref={sourceInputRef}
                  data-testid="studio-source-input"
                  type="file"
                  accept={SUPPORTED_SOURCE_ACCEPT}
                  disabled={submitState.phase === 'submitting'}
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] ?? null
                    if (nextFile !== null && !isSupportedSourceFile(nextFile)) {
                      setSourceFile(null)
                      setSubmitState({ phase: 'error', message: 'PDF, MIDI, MusicXML 파일을 선택하세요.' })
                      return
                    }
                    setSourceFile(nextFile)
                    setSubmitState({ phase: 'idle' })
                  }}
                />
              </label>
              <p className="launch-source-guidance">
                악보 프로그램에서 내보낸 PDF는 인식률이 높습니다. 스캔/사진 PDF는 품질에 따라 실패할 수 있습니다. 가장 안정적인 형식은 MIDI 또는 MusicXML입니다.
              </p>
              {sourceFile ? (
                <div className="launch-source-summary">
                  <span>{sourceFile.name}</span>
                  <button type="button" disabled={submitState.phase === 'submitting'} onClick={clearSourceFile}>
                    선택 해제
                  </button>
                </div>
              ) : null}

            </div>

            <div className="launch-actions">
              <button
                data-testid="upload-and-start-button"
                className="app-button"
                type="button"
                hidden={!sourceFile}
                disabled={submitState.phase === 'submitting' || !canUploadStart}
                onClick={() => void uploadAndStart()}
              >
                악보 파일로 시작
              </button>
              <button
                data-testid="start-blank-button"
                className="app-button app-button--secondary"
                type="button"
                hidden={Boolean(sourceFile)}
                disabled={submitState.phase === 'submitting' || !canStartBlank}
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
          <span>준비 완료</span>
          <span>트랙 1-6</span>
          <span>편집 / 악보 파일 / 빈 스튜디오</span>
        </footer>
      </section>

      {recentStudios.length > 0 || recentMessage ? (
        <section className="launch-recent" aria-label="스튜디오 목록">
          <div>
            <p className="eyebrow">스튜디오 목록</p>
            {recentMessage ? <p>{recentMessage}</p> : null}
            <button className="launch-recent__refresh" type="button" onClick={refreshRecentStudios}>
              다시 확인
            </button>
          </div>
          {recentStudios.map((studio) => (
            <button
              key={studio.studio_id}
              className={`launch-recent__item${selectedStudioId === studio.studio_id ? ' is-selected' : ''}`}
              type="button"
              onClick={() => selectStudioFromList(studio)}
            >
              <strong>{studio.title}</strong>
              <span>
                {studio.bpm} BPM | {studio.time_signature_numerator ?? 4}/{studio.time_signature_denominator ?? 4} |
                등록 {studio.registered_track_count}/6 | 리포트 {studio.report_count}
              </span>
            </button>
          ))}
          {selectedStudio ? (
            <div className="launch-studio-gate" role="group" aria-label={`${selectedStudio.title} 입장 또는 삭제`}>
              <strong>{selectedStudio.title}</strong>
              <label>
                <span>비밀번호</span>
                <input
                  type="password"
                  value={selectedStudioPassword}
                  onChange={(event) => {
                    setSelectedStudioPassword(event.target.value)
                    setSelectedStudioMessage(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void enterSelectedStudio()
                    }
                  }}
                />
              </label>
              <div className="launch-studio-gate__actions">
                <button className="app-button" type="button" onClick={() => void enterSelectedStudio()}>
                  진입
                </button>
                <button type="button" onClick={() => void deactivateSelectedStudio()}>
                  삭제
                </button>
              </div>
              {selectedStudioMessage ? <p>{selectedStudioMessage}</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  )
}
