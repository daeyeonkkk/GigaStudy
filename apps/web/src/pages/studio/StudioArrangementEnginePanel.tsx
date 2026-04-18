import { Link } from 'react-router-dom'

import { useStudioCompactViewport } from './useStudioCompactViewport'

type StatusTone = 'error' | 'loading' | 'ready'

type SelectOption = {
  label: string
  value: string
}

type SummaryCard = {
  description: string
  label: string
  title: string
}

type CandidateCard = {
  beatboxCountLabel: string
  chipLabels: string[]
  id: string
  leadFitLabel: string
  maxLeapLabel: string
  midiUrl: string | null
  parallelAlertsLabel: string
  selected: boolean
  selectLabel: string
  subtitle: string
  summaryDescription: string
  summaryTitle: string
  title: string
}

type MessageTone = 'error' | 'hint'

type StudioArrangementEnginePanelProps = {
  arrangementRoute: string
  candidateCards: CandidateCard[]
  generateButtonDisabled: boolean
  generateButtonLabel: string
  onBeatboxTemplateChange: (value: string) => void
  onDifficultyChange: (value: string) => void
  onGenerate: () => void
  onRefresh: () => void
  onSave: () => void
  onSelectArrangement: (id: string) => void
  onStyleChange: (value: string) => void
  onVoiceRangePresetChange: (value: string) => void
  presetSummaryCards: SummaryCard[]
  presetSummaryLabel: string
  primaryMessage: { text: string; tone: MessageTone }
  saveButtonDisabled: boolean
  saveButtonLabel: string
  saveMessage: { text: string; tone: MessageTone } | null
  selectedBeatboxTemplate: string
  selectedDifficulty: string
  selectedStyle: string
  selectedVoiceRangePreset: string
  statusLabel: string
  statusTone: StatusTone
  styleOptions: ReadonlyArray<SelectOption>
  voiceRangeOptions: ReadonlyArray<SelectOption>
  beatboxTemplateOptions: ReadonlyArray<SelectOption>
  difficultyOptions: ReadonlyArray<SelectOption>
}

export function StudioArrangementEnginePanel({
  arrangementRoute,
  beatboxTemplateOptions,
  candidateCards,
  difficultyOptions,
  generateButtonDisabled,
  generateButtonLabel,
  onBeatboxTemplateChange,
  onDifficultyChange,
  onGenerate,
  onRefresh,
  onSave,
  onSelectArrangement,
  onStyleChange,
  onVoiceRangePresetChange,
  presetSummaryCards,
  presetSummaryLabel,
  primaryMessage,
  saveButtonDisabled,
  saveButtonLabel,
  saveMessage,
  selectedBeatboxTemplate,
  selectedDifficulty,
  selectedStyle,
  selectedVoiceRangePreset,
  statusLabel,
  statusTone,
  styleOptions,
  voiceRangeOptions,
}: StudioArrangementEnginePanelProps) {
  const isCompactViewport = useStudioCompactViewport()

  return (
    <article className="panel studio-block" data-testid="arrangement-engine-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">편곡 생성</p>
          <h2>후보 생성</h2>
        </div>
        <span className={`status-pill status-pill--${statusTone}`}>{statusLabel}</span>
      </div>

      <p className="panel__summary">
        편역, 제약, 병행 진행 회피를 가진 편곡 후보 2~3개를 만드는 구간입니다. 스타일, 난이도, 리드
        편역, 비트박스 템플릿을 묶어서 비교 흐름까지 한곳에서 이어갑니다.
      </p>

      <div className="field-grid">
        <label className="field">
          <span>스타일</span>
          <select
            className="text-input"
            value={selectedStyle}
            onChange={(event) => onStyleChange(event.target.value)}
          >
            {styleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>난이도</span>
          <select
            className="text-input"
            value={selectedDifficulty}
            onChange={(event) => onDifficultyChange(event.target.value)}
          >
            {difficultyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>리드 편역 프리셋</span>
          <select
            className="text-input"
            value={selectedVoiceRangePreset}
            onChange={(event) => onVoiceRangePresetChange(event.target.value)}
          >
            {voiceRangeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>비트박스 템플릿</span>
          <select
            className="text-input"
            value={selectedBeatboxTemplate}
            onChange={(event) => onBeatboxTemplateChange(event.target.value)}
          >
            {beatboxTemplateOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <details
        className="studio-mobile-fold studio-mobile-fold--secondary"
        open={isCompactViewport ? undefined : true}
      >
        <summary className="studio-mobile-fold__summary">
          <span>프리셋 요약</span>
          <strong>{presetSummaryLabel}</strong>
        </summary>
        <div className="studio-mobile-fold__body">
          <div className="mini-grid">
            {presetSummaryCards.map((card) => (
              <div className="mini-card mini-card--stack" key={`${card.label}-${card.title}`}>
                <span>{card.label}</span>
                <strong>{card.title}</strong>
                <small>{card.description}</small>
              </div>
            ))}
          </div>
        </div>
      </details>

      <div className="button-row">
        <button
          data-testid="generate-arrangements-button"
          className="button-primary"
          type="button"
          disabled={generateButtonDisabled}
          onClick={onGenerate}
        >
          {generateButtonLabel}
        </button>

        <button
          className="button-secondary"
          type="button"
          disabled={saveButtonDisabled}
          onClick={onSave}
        >
          {saveButtonLabel}
        </button>

        <button className="button-secondary" type="button" onClick={onRefresh}>
          스냅샷 새로고침
        </button>

        <Link className="button-secondary" to={arrangementRoute}>
          편곡 작업 화면 열기
        </Link>
      </div>

      <p className={primaryMessage.tone === 'error' ? 'form-error' : 'status-card__hint'}>
        {primaryMessage.text}
      </p>

      {saveMessage ? (
        <p className={saveMessage.tone === 'error' ? 'form-error' : 'status-card__hint'}>
          {saveMessage.text}
        </p>
      ) : null}

      <div className="candidate-grid">
        {candidateCards.length === 0 ? (
          <div className="empty-card">
            <p>아직 편곡 후보가 없습니다.</p>
            <p>멜로디 초안을 추출한 뒤 A/B/C 후보를 생성해 주세요.</p>
          </div>
        ) : (
          candidateCards.map((candidate) => (
            <article
              className={`candidate-card ${candidate.selected ? 'candidate-card--selected' : ''}`}
              key={candidate.id}
            >
              <div className="candidate-card__header">
                <div>
                  <strong>{candidate.title}</strong>
                  <span>{candidate.subtitle}</span>
                </div>

                <button
                  className="button-secondary button-secondary--small"
                  type="button"
                  onClick={() => onSelectArrangement(candidate.id)}
                >
                  {candidate.selectLabel}
                </button>
              </div>

              <div className="mini-grid">
                <div className="mini-card">
                  <span>리드 적합도</span>
                  <strong>{candidate.leadFitLabel}</strong>
                </div>
                <div className="mini-card">
                  <span>최대 도약</span>
                  <strong>{candidate.maxLeapLabel}</strong>
                </div>
                <div className="mini-card">
                  <span>병행 경고</span>
                  <strong>{candidate.parallelAlertsLabel}</strong>
                </div>
                <div className="mini-card">
                  <span>비트박스 노트</span>
                  <strong>{candidate.beatboxCountLabel}</strong>
                </div>
              </div>

              <div className="candidate-chip-row">
                {candidate.chipLabels.map((chip) => (
                  <span className="candidate-chip" key={`${candidate.id}-${chip}`}>
                    {chip}
                  </span>
                ))}
              </div>

              <div className="mini-card mini-card--stack">
                <span>비교 요약</span>
                <strong>{candidate.summaryTitle}</strong>
                <small>{candidate.summaryDescription}</small>
              </div>

              {candidate.midiUrl ? (
                <a className="button-secondary" href={candidate.midiUrl}>
                  편곡 MIDI 내려받기
                </a>
              ) : null}
            </article>
          ))
        )}
      </div>
    </article>
  )
}
