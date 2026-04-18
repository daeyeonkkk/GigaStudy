type StatusTone = 'error' | 'loading' | 'ready'
type MessageTone = 'error' | 'hint'

type SelectOption = {
  label: string
  value: string
}

type SummaryCard = {
  description?: string
  label: string
  value: string
}

type WarningItem = {
  description: string
  title: string
}

type StudioAudioSetupPanelProps = {
  appliedSettingsLabel: string
  autoGainControl: boolean
  channelCount: number
  deviceCards: SummaryCard[]
  echoCancellation: boolean
  inputOptions: ReadonlyArray<SelectOption>
  inputSelectionDisabled: boolean
  noiseSuppression: boolean
  onAutoGainControlChange: (checked: boolean) => void
  onChannelCountChange: (value: number) => void
  onEchoCancellationChange: (checked: boolean) => void
  onNoiseSuppressionChange: (checked: boolean) => void
  onOutputRouteChange: (value: string) => void
  onRefreshInputs: () => void
  onRequestMicrophoneAccess: () => void
  onSaveDeviceProfile: () => void
  onSelectedInputChange: (value: string) => void
  outputOptions: ReadonlyArray<SelectOption>
  outputRoute: string
  permissionMessage: { text: string; tone: MessageTone }
  requestButtonDisabled: boolean
  requestButtonLabel: string
  requestedSettingsLabel: string
  saveButtonDisabled: boolean
  saveButtonLabel: string
  saveMessage: { text: string; tone: MessageTone } | null
  selectedInputId: string
  statusLabel: string
  statusTone: StatusTone
  warningEmptyMessage: { hint: string; title: string }
  warningItems: WarningItem[]
  warningSectionTitle: string | null
}

export function StudioAudioSetupPanel({
  appliedSettingsLabel,
  autoGainControl,
  channelCount,
  deviceCards,
  echoCancellation,
  inputOptions,
  inputSelectionDisabled,
  noiseSuppression,
  onAutoGainControlChange,
  onChannelCountChange,
  onEchoCancellationChange,
  onNoiseSuppressionChange,
  onOutputRouteChange,
  onRefreshInputs,
  onRequestMicrophoneAccess,
  onSaveDeviceProfile,
  onSelectedInputChange,
  outputOptions,
  outputRoute,
  permissionMessage,
  requestButtonDisabled,
  requestButtonLabel,
  requestedSettingsLabel,
  saveButtonDisabled,
  saveButtonLabel,
  saveMessage,
  selectedInputId,
  statusLabel,
  statusTone,
  warningEmptyMessage,
  warningItems,
  warningSectionTitle,
}: StudioAudioSetupPanelProps) {
  return (
    <article className="panel studio-block">
      <div className="panel-header">
        <div>
          <p className="eyebrow">장치 패널</p>
          <h2>장치</h2>
        </div>
        <span className={`status-pill status-pill--${statusTone}`}>{statusLabel}</span>
      </div>

      <p className="panel__summary">
        요청한 입력 설정과 실제 적용 결과를 함께 저장해, 이후 피드백에서 장치 차이를 추정이 아니라
        기록으로 설명할 수 있게 합니다.
      </p>

      <div className="button-row">
        <button
          data-testid="request-microphone-button"
          className="button-primary"
          type="button"
          disabled={requestButtonDisabled}
          onClick={onRequestMicrophoneAccess}
        >
          {requestButtonLabel}
        </button>

        <button className="button-secondary" type="button" onClick={onRefreshInputs}>
          입력 장치 목록 새로고침
        </button>
      </div>

      <p className={permissionMessage.tone === 'error' ? 'form-error' : 'status-card__hint'}>
        {permissionMessage.text}
      </p>

      <div className="field-grid">
        <label className="field">
          <span>입력 장치</span>
          <select
            className="text-input"
            value={selectedInputId}
            disabled={inputSelectionDisabled || inputOptions.length === 0}
            onChange={(event) => onSelectedInputChange(event.target.value)}
          >
            {inputOptions.length === 0 ? <option value="">아직 감지된 마이크가 없습니다</option> : null}
            {inputOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>출력 경로</span>
          <select
            className="text-input"
            value={outputRoute}
            onChange={(event) => onOutputRouteChange(event.target.value)}
          >
            {outputOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="toggle-grid">
        <label className="toggle-card">
          <input
            type="checkbox"
            checked={echoCancellation}
            onChange={(event) => onEchoCancellationChange(event.target.checked)}
          />
          <div>
            <strong>에코 줄이기</strong>
            <span>울림과 되먹임을 줄이도록 브라우저에 요청하고 결과도 함께 남깁니다.</span>
          </div>
        </label>

        <label className="toggle-card">
          <input
            type="checkbox"
            checked={autoGainControl}
            onChange={(event) => onAutoGainControlChange(event.target.checked)}
          />
          <div>
            <strong>자동 음량 보정</strong>
            <span>브라우저가 입력 음량을 자동으로 손봤는지 함께 기록합니다.</span>
          </div>
        </label>

        <label className="toggle-card">
          <input
            type="checkbox"
            checked={noiseSuppression}
            onChange={(event) => onNoiseSuppressionChange(event.target.checked)}
          />
          <div>
            <strong>잡음 줄이기</strong>
            <span>배경 잡음을 얼마나 줄였는지 확인할 수 있도록 기록합니다.</span>
          </div>
        </label>
      </div>

      <label className="field field--compact">
        <span>요청 채널 수</span>
        <input
          className="text-input"
          type="number"
          min={1}
          max={2}
          value={channelCount}
          onChange={(event) => onChannelCountChange(Math.max(1, Number(event.target.value) || 1))}
        />
      </label>

      <div className="button-row">
        <button
          data-testid="save-device-profile-button"
          className="button-primary"
          type="button"
          disabled={saveButtonDisabled}
          onClick={onSaveDeviceProfile}
        >
          {saveButtonLabel}
        </button>
      </div>

      {saveMessage ? (
        <p className={saveMessage.tone === 'error' ? 'form-error' : 'status-card__hint'}>{saveMessage.text}</p>
      ) : null}

      <div className="mini-grid">
        <div className="mini-card mini-card--stack">
          <span>요청한 입력 설정</span>
          <strong>{requestedSettingsLabel}</strong>
          <small>요청 채널 수 {channelCount}채널</small>
        </div>

        <div className="mini-card mini-card--stack">
          <span>최근 적용 결과</span>
          <strong>{appliedSettingsLabel}</strong>
          <small>브라우저가 실제로 적용한 입력 상태를 기준으로 저장합니다.</small>
        </div>
      </div>

      <div className="mini-grid">
        {deviceCards.map((card) => (
          <div className={`mini-card${card.description ? ' mini-card--stack' : ''}`} key={`${card.label}-${card.value}`}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            {card.description ? <small>{card.description}</small> : null}
          </div>
        ))}
      </div>

      {warningSectionTitle ? (
        <div className="support-stack">
          <div>
            <p className="json-label">{warningSectionTitle}</p>
            {warningItems.length > 0 ? (
              <ul className="ticket-list">
                {warningItems.map((item) => (
                  <li key={item.title}>
                    <strong>{item.title}</strong>
                    <span>{item.description}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-card">
                <p>{warningEmptyMessage.title}</p>
                <p>{warningEmptyMessage.hint}</p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </article>
  )
}
