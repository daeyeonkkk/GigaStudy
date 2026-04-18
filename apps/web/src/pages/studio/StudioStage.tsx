import { Link } from 'react-router-dom'

import { WaveformPreview } from '../../components/WaveformPreview'
import type { AudioPreviewData } from '../../lib/audioPreview'

type EditorPrimaryAction = 'analysis' | 'arrangement' | 'recording'
type EditorRangeMode = 'note' | 'take'
type StageStatusTone = 'error' | 'loading' | 'ready'

type StudioStageProps = {
  analysisButtonDisabled: boolean
  analysisButtonLabel: string
  arrangementRoute: string | null
  editorPrimaryAction: EditorPrimaryAction
  editorRangeEndLabel: string
  editorRangeMode: EditorRangeMode
  editorRangeStartLabel: string
  editorRangeTitle: string
  fileChipLabel: string
  fileChipMeta: string | null
  humanRatingPacketUrl: string | null
  isRecordingActive: boolean
  isRecordingLocked: boolean
  metronomeButtonDisabled: boolean
  metronomeButtonLabel: string
  noteViewDisabled: boolean
  onOpenAnalysisWorkbench: () => void
  onOpenArrangementWorkbench: () => void
  onOpenRecordingWorkbench: () => void
  onPreviewMetronome: () => void
  onRunAnalysis: () => void
  onSetEditorRangeMode: (mode: EditorRangeMode) => void
  onToggleRecording: () => void
  onStopRecording: () => void
  projectRealEvidenceBatchUrl: string | null
  quickStopDisabled: boolean
  realEvidenceBatchUrl: string | null
  recordingToggleLabel: string
  selectedTakeExists: boolean
  stageMetaItems: string[]
  waveformPreview: AudioPreviewData | null
  waveformStatusLabel: string
  waveformStatusTone: StageStatusTone
}

export function StudioStage({
  analysisButtonDisabled,
  analysisButtonLabel,
  arrangementRoute,
  editorPrimaryAction,
  editorRangeEndLabel,
  editorRangeMode,
  editorRangeStartLabel,
  editorRangeTitle,
  fileChipLabel,
  fileChipMeta,
  humanRatingPacketUrl,
  isRecordingActive,
  isRecordingLocked,
  metronomeButtonDisabled,
  metronomeButtonLabel,
  noteViewDisabled,
  onOpenAnalysisWorkbench,
  onOpenArrangementWorkbench,
  onOpenRecordingWorkbench,
  onPreviewMetronome,
  onRunAnalysis,
  onSetEditorRangeMode,
  onStopRecording,
  onToggleRecording,
  projectRealEvidenceBatchUrl,
  quickStopDisabled,
  realEvidenceBatchUrl,
  recordingToggleLabel,
  selectedTakeExists,
  stageMetaItems,
  waveformPreview,
  waveformStatusLabel,
  waveformStatusTone,
}: StudioStageProps) {
  return (
    <>
      <div className="studio-wave-editor__file-chip">
        <span className="studio-wave-editor__file-close" aria-hidden="true">
          ×
        </span>
        <div>
          <strong>{fileChipLabel}</strong>
          {fileChipMeta ? <small>{fileChipMeta}</small> : null}
        </div>
      </div>

      <article className="panel studio-wave-editor__stage">
        <div className="studio-wave-editor__stage-header">
          <div>
            <p className="eyebrow">파형</p>
            <h2>{selectedTakeExists ? '선택 테이크' : '테이크 선택'}</h2>
          </div>
          <span className={`status-pill status-pill--${waveformStatusTone}`}>{waveformStatusLabel}</span>
        </div>

        <div className="studio-wave-editor__stage-meta">
          {stageMetaItems.map((item, index) => (
            <span key={`${index}-${item}`}>{item}</span>
          ))}
        </div>

        <div className="studio-wave-editor__canvas">
          {waveformPreview ? (
            <WaveformPreview preview={waveformPreview} />
          ) : (
            <div className="empty-card">
              <p>파형 없음</p>
            </div>
          )}
        </div>

        <div className="studio-wave-editor__transport-row">
          <button
            data-testid="quick-start-take-button"
            className={`button-primary studio-record-toggle ${
              isRecordingActive ? 'studio-record-toggle--active' : ''
            }`}
            type="button"
            aria-label={recordingToggleLabel}
            aria-pressed={isRecordingActive}
            data-recording-label={recordingToggleLabel}
            disabled={isRecordingLocked}
            onClick={onToggleRecording}
          >
            {recordingToggleLabel}
          </button>

          <button
            data-testid="quick-stop-take-button"
            className="button-secondary"
            type="button"
            disabled={quickStopDisabled}
            onClick={onStopRecording}
          >
            녹음 멈추기
          </button>

          <button
            className="button-secondary"
            type="button"
            disabled={metronomeButtonDisabled}
            onClick={onPreviewMetronome}
          >
            {metronomeButtonLabel}
          </button>

          <button
            data-testid="quick-analyze-take-button"
            className="button-secondary"
            type="button"
            disabled={analysisButtonDisabled}
            onClick={onRunAnalysis}
          >
            {analysisButtonLabel}
          </button>
        </div>
      </article>

      <article className="panel studio-wave-editor__control-strip">
        <div className="studio-wave-editor__range-grid">
          <label className="studio-wave-editor__field">
            <span>시작</span>
            <strong>{editorRangeStartLabel}</strong>
          </label>
          <label className="studio-wave-editor__field">
            <span>끝</span>
            <strong>{editorRangeEndLabel}</strong>
          </label>
        </div>

        <div className="studio-wave-editor__mode-box">
          <span className="studio-wave-editor__mode-label">보기 방식</span>
          <div className="studio-wave-editor__mode-options">
            <label>
              <input
                checked={editorRangeMode === 'take'}
                name="studio-range-mode"
                type="radio"
                onChange={() => onSetEditorRangeMode('take')}
              />
              전체 흐름 보기
            </label>
            <label>
              <input
                checked={editorRangeMode === 'note'}
                disabled={noteViewDisabled}
                name="studio-range-mode"
                type="radio"
                onChange={() => onSetEditorRangeMode('note')}
              />
              선택 노트 보기
            </label>
          </div>
        </div>

        <div className="studio-wave-editor__action-box">
          <div className="studio-wave-editor__action-copy">
            <span>작업</span>
            <strong>{editorRangeTitle}</strong>
          </div>

          <div className="studio-wave-editor__action-buttons">
            <details className="advanced-panel studio-inline-tools studio-inline-tools--export">
              <summary className="advanced-panel__summary">자료</summary>
              <div className="advanced-panel__body studio-inline-tools__body studio-inline-tools__body--stack">
                {humanRatingPacketUrl ? (
                  <a
                    data-testid="download-human-rating-packet-button"
                    className="button-secondary button-secondary--small"
                    href={humanRatingPacketUrl}
                  >
                    평가 자료 받기
                  </a>
                ) : (
                  <button className="button-secondary button-secondary--small" disabled type="button">
                    평가 자료 받기
                  </button>
                )}

                {realEvidenceBatchUrl ? (
                  <a
                    data-testid="download-real-evidence-batch-button"
                    className="button-secondary button-secondary--small"
                    href={realEvidenceBatchUrl}
                  >
                    선택 테이크 묶음
                  </a>
                ) : (
                  <button className="button-secondary button-secondary--small" disabled type="button">
                    선택 테이크 묶음
                  </button>
                )}

                {projectRealEvidenceBatchUrl ? (
                  <a
                    data-testid="download-project-real-evidence-batch-button"
                    className="button-secondary button-secondary--small"
                    href={projectRealEvidenceBatchUrl}
                  >
                    준비된 테이크 묶음
                  </a>
                ) : (
                  <button className="button-secondary button-secondary--small" disabled type="button">
                    준비된 테이크 묶음
                  </button>
                )}
              </div>
            </details>

            {editorPrimaryAction === 'arrangement' ? (
              arrangementRoute ? (
                <Link className="button-primary" to={arrangementRoute}>
                  편곡 화면 열기
                </Link>
              ) : (
                <button className="button-primary" type="button" onClick={onOpenArrangementWorkbench}>
                  편곡 구역 열기
                </button>
              )
            ) : editorPrimaryAction === 'analysis' ? (
              <button className="button-primary" type="button" onClick={onOpenAnalysisWorkbench}>
                노트 피드백 열기
              </button>
            ) : (
              <button className="button-primary" type="button" onClick={onOpenRecordingWorkbench}>
                녹음 구역 열기
              </button>
            )}
          </div>
        </div>
      </article>
    </>
  )
}
