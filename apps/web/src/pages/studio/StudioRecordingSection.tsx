import type { CSSProperties } from 'react'

import { ManagedAudioPlayer } from '../../components/ManagedAudioPlayer'

type RecordingTakeItem = {
  durationLabel: string
  failedUpload: boolean
  finishedAtLabel: string
  id: string
  label: string
  muted: boolean
  onRetryUpload: () => void
  onSelect: () => void
  previewUrl: string | null
  progress: number | null
  retryUploadDisabled: boolean
  retryUploadLabel: string
  selected: boolean
  subhead: string
  volume: number
}

type StudioRecordingSectionProps = {
  className: string
  countInBeats: number
  isRecordingActive: boolean
  isRecordingLocked: boolean
  liveInputMeterLevelPercent: number
  liveInputMeterMessage: string
  liveInputMeterPeakPercent: number
  liveInputMeterPhase: string
  liveInputMeterStatusLabel: string
  liveInputMeterTone: 'error' | 'loading' | 'ready'
  metronomeEnabled: boolean
  metronomePreviewButtonDisabled: boolean
  metronomePreviewButtonLabel: string
  metronomePreviewMessage: string | null
  metronomePreviewTone: 'error' | 'hint'
  onCountInChange: (value: number) => void
  onPreviewMetronome: () => void
  onRefreshTakes: () => void
  onStopRecording: () => void
  onToggleMetronome: (checked: boolean) => void
  onToggleRecording: () => void
  recordingMessage: string
  recordingStatusLabel: string
  recordingStatusTone: 'error' | 'loading' | 'ready'
  recordingToggleLabel: string
  selectedTakeFieldLabel: string
  stopRecordingDisabled: boolean
  takeItems: RecordingTakeItem[]
  takeSummaryItems: Array<{ label: string; value: string }>
  takesErrorMessage: string | null
  timeSignatureLabel: string
  transportAccentEveryLabel: string
  transportBpmLabel: string
  transportKeyLabel: string
}

export function StudioRecordingSection({
  className,
  countInBeats,
  isRecordingActive,
  isRecordingLocked,
  liveInputMeterLevelPercent,
  liveInputMeterMessage,
  liveInputMeterPeakPercent,
  liveInputMeterPhase,
  liveInputMeterStatusLabel,
  liveInputMeterTone,
  metronomeEnabled,
  metronomePreviewButtonDisabled,
  metronomePreviewButtonLabel,
  metronomePreviewMessage,
  metronomePreviewTone,
  onCountInChange,
  onPreviewMetronome,
  onRefreshTakes,
  onStopRecording,
  onToggleMetronome,
  onToggleRecording,
  recordingMessage,
  recordingStatusLabel,
  recordingStatusTone,
  recordingToggleLabel,
  selectedTakeFieldLabel,
  stopRecordingDisabled,
  takeItems,
  takeSummaryItems,
  takesErrorMessage,
  timeSignatureLabel,
  transportAccentEveryLabel,
  transportBpmLabel,
  transportKeyLabel,
}: StudioRecordingSectionProps) {
  return (
    <section className={className} id="recording">
      <div className="section__header">
        <p className="eyebrow">녹음 흐름</p>
        <h2>녹음</h2>
      </div>

      <div className="card-grid studio-work-grid">
        <article className="panel studio-block">
          <div className="panel-header">
            <div>
              <p className="eyebrow">메트로놈</p>
              <h2>메트로놈 / 카운트인</h2>
            </div>
            <span className={`status-pill ${metronomeEnabled ? 'status-pill--ready' : 'status-pill--loading'}`}>
              {metronomeEnabled ? '메트로놈 켜짐' : '메트로놈 꺼짐'}
            </span>
          </div>

          <p className="panel__summary">
            가이드 재생과 사전 준비를 한 곳에 묶고, 템포와 키, 메트로놈, 카운트인을 바로 확인합니다.
          </p>

          <div className="mini-grid">
            <div className="mini-card">
              <span>템포</span>
              <strong>{transportBpmLabel}</strong>
            </div>
            <div className="mini-card">
              <span>키</span>
              <strong>{transportKeyLabel}</strong>
            </div>
            <div className="mini-card">
              <span>박자</span>
              <strong>{timeSignatureLabel}</strong>
            </div>
            <div className="mini-card">
              <span>강박 주기</span>
              <strong>{transportAccentEveryLabel}</strong>
            </div>
          </div>

          <div className="toggle-grid">
            <label className="toggle-card">
              <input
                data-testid="metronome-recording-checkbox"
                type="checkbox"
                checked={metronomeEnabled}
                onChange={(event) => onToggleMetronome(event.target.checked)}
              />
              <div>
                <strong>녹음 중 메트로놈</strong>
                <span>테이크를 녹음하는 동안 헤드폰으로 가이드 템포를 계속 들려줍니다.</span>
              </div>
            </label>
          </div>

          <div className="field-grid">
            <label className="field">
              <span>카운트인 길이</span>
              <select
                data-testid="count-in-select"
                className="text-input"
                value={countInBeats}
                onChange={(event) => onCountInChange(Number(event.target.value))}
              >
                <option value={0}>사용 안 함</option>
                <option value={2}>2박</option>
                <option value={4}>4박</option>
                <option value={8}>8박</option>
              </select>
            </label>

            <label className="field">
              <span>선택된 테이크</span>
              <input className="text-input" value={selectedTakeFieldLabel} readOnly />
            </label>
          </div>

          <div className="button-row">
            <button
              className="button-primary"
              type="button"
              disabled={metronomePreviewButtonDisabled}
              onClick={onPreviewMetronome}
            >
              {metronomePreviewButtonLabel}
            </button>
          </div>

          {metronomePreviewMessage ? (
            <p className={metronomePreviewTone === 'error' ? 'form-error' : 'status-card__hint'}>
              {metronomePreviewMessage}
            </p>
          ) : (
            <p className="status-card__hint">
              다음 테이크 전에 미리듣기로 박 감각과 준비 상태를 먼저 확인해 보세요.
            </p>
          )}
        </article>

        <article className="panel studio-block" data-testid="recorder-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">레코더</p>
              <h2>테이크</h2>
            </div>
            <span className={`status-pill status-pill--${recordingStatusTone}`}>{recordingStatusLabel}</span>
          </div>

          <p className="panel__summary">
            녹음을 시작하고 멈추고 테이크를 만들고 업로드 흐름을 한곳에서 관리합니다. 실패한 업로드는 여기서
            다시 시도할 수 있습니다.
          </p>

          <div className="button-row">
            <button
              data-testid="start-take-button"
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
              data-testid="stop-take-button"
              className="button-secondary"
              type="button"
              disabled={stopRecordingDisabled}
              onClick={onStopRecording}
            >
              테이크 중지
            </button>

            <button className="button-secondary" type="button" onClick={onRefreshTakes}>
              테이크 목록 새로고침
            </button>
          </div>

          <p className={recordingStatusTone === 'error' ? 'form-error' : 'status-card__hint'}>
            {recordingMessage}
          </p>

          <div className="live-input-meter" aria-live="polite">
            <div className="live-input-meter__header">
              <div>
                <span className="shared-review-label">실시간 입력</span>
                <strong>{liveInputMeterMessage}</strong>
              </div>
              <span className={`status-pill status-pill--${liveInputMeterTone}`}>{liveInputMeterPhase}</span>
            </div>

            <div
              className="live-input-meter__bar"
              role="meter"
              aria-label="실시간 입력 미터"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(liveInputMeterLevelPercent)}
            >
              <div
                className="live-input-meter__fill"
                style={
                  {
                    '--meter-level': `${liveInputMeterLevelPercent}%`,
                    '--meter-peak': `${liveInputMeterPeakPercent}%`,
                  } as CSSProperties
                }
              />
            </div>

            <div className="live-input-meter__meta">
              <span>RMS {Math.round(liveInputMeterLevelPercent)}%</span>
              <span>Peak {Math.round(liveInputMeterPeakPercent)}%</span>
              <span>{liveInputMeterStatusLabel}</span>
            </div>
          </div>

          <div className="take-summary-grid">
            {takeSummaryItems.map((item) => (
              <div className="mini-card" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>

          {takesErrorMessage ? <p className="form-error">{takesErrorMessage}</p> : null}

          <div className="take-list">
            {takeItems.length === 0 ? (
              <div className="empty-card">
                <p>아직 테이크가 없습니다.</p>
                <p>테이크를 한 번 녹음하면 업로드와 재시도 흐름이 함께 열립니다.</p>
              </div>
            ) : (
              takeItems.map((take) => (
                <article
                  className={`take-card ${take.selected ? 'take-card--selected' : ''}`}
                  key={take.id}
                >
                  <div className="take-card__header">
                    <div>
                      <h3>{take.label}</h3>
                      <p className="take-card__subhead">{take.subhead}</p>
                    </div>

                    <button
                      className="button-secondary button-secondary--small"
                      type="button"
                      onClick={take.onSelect}
                    >
                      선택
                    </button>
                  </div>

                  <div className="mini-grid">
                    <div className="mini-card">
                      <span>녹음 완료 시각</span>
                      <strong>{take.finishedAtLabel}</strong>
                    </div>
                    <div className="mini-card">
                      <span>길이</span>
                      <strong>{take.durationLabel}</strong>
                    </div>
                  </div>

                  {typeof take.progress === 'number' && take.progress < 100 ? (
                    <div className="progress-stack">
                      <div className="progress-bar" aria-hidden="true">
                        <span style={{ width: `${take.progress}%` }} />
                      </div>
                      <p className="status-card__hint">업로드 진행률 {take.progress}%</p>
                    </div>
                  ) : null}

                  {take.previewUrl ? (
                    <div className="audio-preview">
                      <p className="json-label">테이크 미리듣기</p>
                      <ManagedAudioPlayer
                        muted={take.muted}
                        src={take.previewUrl}
                        volume={take.volume}
                      />
                    </div>
                  ) : null}

                  {take.failedUpload ? (
                    <div className="support-stack">
                      <p className="form-error">
                        이 테이크의 업로드가 아직 끝나지 않았습니다. 같은 오디오로 다시 시도하거나 새로
                        녹음해 주세요.
                      </p>
                      <div className="button-row">
                        <button
                          className="button-primary"
                          type="button"
                          disabled={take.retryUploadDisabled}
                          onClick={take.onRetryUpload}
                        >
                          {take.retryUploadLabel}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </article>
      </div>
    </section>
  )
}
