import type { RefObject } from 'react'

import { ManagedAudioPlayer } from '../../components/ManagedAudioPlayer'

type StatusTone = 'error' | 'loading' | 'ready'
type MessageTone = 'error' | 'hint'

type SummaryCard = {
  label: string
  value: string
}

type StudioGuidePanelProps = {
  fileSelectionMessage: string
  fileSelectionTone: MessageTone
  fileInputRef: RefObject<HTMLInputElement | null>
  guideErrorMessage: string | null
  guidePlayerMuted: boolean
  guidePlayerVolume: number
  guideSourceUrl: string | null
  guideStatusLabel: string
  guideStatusTone: StatusTone
  hasGuide: boolean
  onFileChange: (file: File | null) => void
  onUpload: () => void
  statusCards: SummaryCard[]
  trackFailureMessage: string | null
  uploadButtonDisabled: boolean
  uploadButtonLabel: string
  uploadMessage: { text: string; tone: MessageTone } | null
}

export function StudioGuidePanel({
  fileSelectionMessage,
  fileSelectionTone,
  fileInputRef,
  guideErrorMessage,
  guidePlayerMuted,
  guidePlayerVolume,
  guideSourceUrl,
  guideStatusLabel,
  guideStatusTone,
  hasGuide,
  onFileChange,
  onUpload,
  statusCards,
  trackFailureMessage,
  uploadButtonDisabled,
  uploadButtonLabel,
  uploadMessage,
}: StudioGuidePanelProps) {
  return (
    <article className="panel studio-block">
      <div className="panel-header">
        <div>
          <p className="eyebrow">가이드 트랙</p>
          <h2>가이드</h2>
        </div>
        <span className={`status-pill status-pill--${guideStatusTone}`}>{guideStatusLabel}</span>
      </div>

      <p className="panel__summary">
        가이드 업로드 준비, 파일 전송, 마무리 처리, 최신 가이드 재생까지 한 흐름으로 이어집니다.
      </p>

      <label className="field">
        <span>가이드 오디오 파일</span>
        <input
          ref={fileInputRef}
          className="text-input"
          type="file"
          accept="audio/*"
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
        />
      </label>

      <p className={fileSelectionTone === 'error' ? 'form-error' : 'status-card__hint'}>{fileSelectionMessage}</p>

      <div className="button-row">
        <button className="button-primary" type="button" disabled={uploadButtonDisabled} onClick={onUpload}>
          {uploadButtonLabel}
        </button>
      </div>

      {uploadMessage ? (
        <p className={uploadMessage.tone === 'error' ? 'form-error' : 'status-card__hint'}>
          {uploadMessage.text}
        </p>
      ) : null}

      {guideErrorMessage ? <p className="form-error">{guideErrorMessage}</p> : null}

      {hasGuide ? (
        <div className="support-stack">
          <div className="mini-grid">
            {statusCards.map((card) => (
              <div className="mini-card" key={`${card.label}-${card.value}`}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </div>
            ))}
          </div>

          {trackFailureMessage ? <p className="form-error">{trackFailureMessage}</p> : null}

          {guideSourceUrl ? (
            <div className="audio-preview">
              <p className="json-label">가이드 재생</p>
              <ManagedAudioPlayer muted={guidePlayerMuted} src={guideSourceUrl} volume={guidePlayerVolume} />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="empty-card">
          <p>이 프로젝트에는 아직 가이드가 없습니다.</p>
          <p>녹음, 비교, 믹스다운이 같은 기준 트랙을 쓰도록 먼저 가이드 하나를 올려 주세요.</p>
        </div>
      )}
    </article>
  )
}
