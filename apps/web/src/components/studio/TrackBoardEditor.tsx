import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

import {
  formatDurationSeconds,
  formatTrackName,
} from '../../lib/studio'
import type {
  ArrangementRegion,
  TrackSlot,
} from '../../types/studio'
import {
  getEventMiniAriaLabel,
  getEventMiniTitle,
  getEventMiniTopPercent,
  getRenderableMiniEvents,
} from './eventMiniLayout'
import { getDurationPercent } from './TrackBoardTimelineLayout'

const MIN_TIMELINE_SECONDS = -30
const MIN_DURATION_SECONDS = 0.08
const MAX_UNDO_STEPS = 24
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export type RegionEditorDraftEvent = {
  event_id: string
  label: string
  pitch_midi: number | null
  start_seconds: number
  duration_seconds: number
  is_rest: boolean
}

export type RegionEditorDraft = {
  target_track_slot_id: number
  start_seconds: number
  duration_seconds: number
  volume_percent: number
  source_label: string
  events: RegionEditorDraftEvent[]
}

type RegionRevisionEntry = {
  revision_id: string
  label: string
  created_at: string
  summary: string
}

type StoredRegionDraft = {
  base_signature: string
  draft: RegionEditorDraft
}

function getEventLeftPercent(event: RegionEditorDraftEvent, regionStartSeconds: number, regionDurationSeconds: number): number {
  return getDurationPercent(event.start_seconds - regionStartSeconds, regionDurationSeconds)
}

function getEventWidthPercent(event: RegionEditorDraftEvent, regionDurationSeconds: number): number {
  return getDurationPercent(event.duration_seconds, regionDurationSeconds)
}

function roundToGrid(value: number, gridSeconds: number): number {
  return Math.round(value / gridSeconds) * gridSeconds
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000
}

function clampTimelineStart(value: number): number {
  return Math.max(MIN_TIMELINE_SECONDS, roundSeconds(value))
}

function clampDuration(value: number): number {
  return Math.max(MIN_DURATION_SECONDS, roundSeconds(value))
}

function clampMidi(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)))
}

function clampVolume(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function midiToLabel(midi: number | null): string {
  if (midi === null || !Number.isFinite(midi)) {
    return 'Rest'
  }
  const pitch = clampMidi(midi)
  const octave = Math.floor(pitch / 12) - 1
  return `${NOTE_NAMES[pitch % 12]}${octave}`
}

function beatSeconds(bpm: number): number {
  return 60 / Math.max(1, bpm)
}

function startBeatForEvent(event: RegionEditorDraftEvent, draft: RegionEditorDraft, bpm: number): number {
  return roundSeconds(1 + ((event.start_seconds - draft.start_seconds) / beatSeconds(bpm)))
}

function durationBeatsForEvent(event: RegionEditorDraftEvent, bpm: number): number {
  return roundSeconds(event.duration_seconds / beatSeconds(bpm))
}

function createDraft(region: ArrangementRegion): RegionEditorDraft {
  return {
    duration_seconds: roundSeconds(region.duration_seconds),
    events: region.pitch_events
      .slice()
      .sort((left, right) => left.start_seconds - right.start_seconds || left.event_id.localeCompare(right.event_id))
      .map((event) => ({
        duration_seconds: roundSeconds(event.duration_seconds),
        event_id: event.event_id,
        is_rest: event.is_rest,
        label: event.label,
        pitch_midi: event.pitch_midi,
        start_seconds: roundSeconds(event.start_seconds),
      })),
    source_label: region.source_label ?? '',
    start_seconds: roundSeconds(region.start_seconds),
    target_track_slot_id: region.track_slot_id,
    volume_percent: region.volume_percent,
  }
}

function draftSignature(draft: RegionEditorDraft | null): string {
  if (!draft) {
    return ''
  }
  return JSON.stringify({
    ...draft,
    events: draft.events.map((event) => ({
      ...event,
      duration_seconds: roundSeconds(event.duration_seconds),
      start_seconds: roundSeconds(event.start_seconds),
    })),
  })
}

function readStoredDraft(
  storageKey: string | null,
  sourceDraft: RegionEditorDraft | null,
  sourceSignature: string,
): RegionEditorDraft | null {
  if (!storageKey || !sourceDraft || typeof window === 'undefined') {
    return sourceDraft
  }
  try {
    const raw = window.sessionStorage.getItem(storageKey)
    if (!raw) {
      return sourceDraft
    }
    const parsed = JSON.parse(raw) as StoredRegionDraft
    if (parsed.base_signature !== sourceSignature || !isRegionEditorDraft(parsed.draft)) {
      return sourceDraft
    }
    return parsed.draft
  } catch {
    return sourceDraft
  }
}

function writeStoredDraft(storageKey: string | null, sourceSignature: string, draft: RegionEditorDraft | null) {
  if (!storageKey || !draft || typeof window === 'undefined') {
    return
  }
  try {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        base_signature: sourceSignature,
        draft,
      } satisfies StoredRegionDraft),
    )
  } catch {
    // Session draft is a convenience. Failing to persist it must not block editing.
  }
}

function clearStoredDraft(storageKey: string | null) {
  if (!storageKey || typeof window === 'undefined') {
    return
  }
  window.sessionStorage.removeItem(storageKey)
}

function isRegionEditorDraft(value: unknown): value is RegionEditorDraft {
  if (!isRecord(value) || !Array.isArray(value.events)) {
    return false
  }
  return (
    typeof value.target_track_slot_id === 'number' &&
    typeof value.start_seconds === 'number' &&
    typeof value.duration_seconds === 'number' &&
    typeof value.volume_percent === 'number' &&
    typeof value.source_label === 'string' &&
    value.events.every(isRegionEditorDraftEvent)
  )
}

function isRegionEditorDraftEvent(value: unknown): value is RegionEditorDraftEvent {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.event_id === 'string' &&
    typeof value.label === 'string' &&
    (typeof value.pitch_midi === 'number' || value.pitch_midi === null) &&
    typeof value.start_seconds === 'number' &&
    typeof value.duration_seconds === 'number' &&
    typeof value.is_rest === 'boolean'
  )
}

function parseNumber(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getRevisionHistory(region: ArrangementRegion | null): RegionRevisionEntry[] {
  if (!region) {
    return []
  }
  const editor = region.diagnostics.region_editor
  if (!isRecord(editor)) {
    return []
  }
  const history = editor.revision_history
  if (!Array.isArray(history)) {
    return []
  }
  return history.flatMap((entry) => {
    if (!isRecord(entry)) {
      return []
    }
    const revisionId = entry.revision_id
    const label = entry.label
    const createdAt = entry.created_at
    const summary = entry.summary
    if (
      typeof revisionId !== 'string' ||
      typeof label !== 'string' ||
      typeof createdAt !== 'string' ||
      typeof summary !== 'string'
    ) {
      return []
    }
    return [{ created_at: createdAt, label, revision_id: revisionId, summary }]
  })
}

function selectedTrackName(tracks: TrackSlot[], slotId: number): string {
  const track = tracks.find((item) => item.slot_id === slotId)
  return formatTrackName(track?.name ?? `Track ${slotId}`)
}

function FieldNumber({
  companionTestId,
  companionText,
  disabled = false,
  label,
  max,
  min,
  step,
  value,
  onChange,
}: {
  companionTestId?: string
  companionText?: string
  disabled?: boolean
  label: string
  max?: number
  min?: number
  step: number
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      <div className="editor-field__entry">
        <input
          aria-label={label}
          disabled={disabled}
          inputMode="decimal"
          max={max}
          min={min}
          step={step}
          type="number"
          value={Number(value.toFixed(3))}
          onChange={(event) => onChange(parseNumber(event.currentTarget.value, value))}
        />
        {companionText ? (
          <span className="editor-field__companion" data-testid={companionTestId}>
            {companionText}
          </span>
        ) : null}
      </div>
    </label>
  )
}

export function RegionTools({
  disabled,
  disabledReason,
  region,
  onCopyRegion,
  onDeleteRegion,
  onSplitRegion,
}: {
  disabled: boolean
  disabledReason: string | null
  gridSeconds: number
  region: ArrangementRegion | null
  tracks: TrackSlot[]
  onCopyRegion: (region: ArrangementRegion, targetSlotId: number, startSeconds: number) => void
  onDeleteRegion: (region: ArrangementRegion) => void
  onSplitRegion: (region: ArrangementRegion, splitSeconds: number) => void
}) {
  if (!region) {
    return <p className="piano-roll-panel__hint">편집할 구간을 선택하세요.</p>
  }

  const midpoint = region.start_seconds + region.duration_seconds / 2

  return (
    <div className="region-tools" aria-label="구간 구조 도구">
      {disabled && disabledReason ? <p className="region-tools__hint">{disabledReason}</p> : null}
      <span className="region-tools__summary">
        {formatTrackName(region.track_name)} · {formatDurationSeconds(region.start_seconds)} -{' '}
        {formatDurationSeconds(region.start_seconds + region.duration_seconds)}
      </span>
      <button
        disabled={disabled}
        type="button"
        onClick={() => onSplitRegion(region, midpoint)}
      >
        중간 자르기
      </button>
      <button
        disabled={disabled}
        type="button"
        onClick={() => onCopyRegion(region, region.track_slot_id, region.start_seconds + region.duration_seconds)}
      >
        뒤에 복사
      </button>
      <button className="region-tools__danger" disabled={disabled} type="button" onClick={() => onDeleteRegion(region)}>
        삭제
      </button>
    </div>
  )
}

type PianoRollPanelProps = {
  bpm: number
  draftStorageKey?: string | null
  disabled: boolean
  disabledReason: string | null
  focusedEventId?: string | null
  gridSeconds: number
  region: ArrangementRegion | null
  selectedEventId: string | null
  tracks: TrackSlot[]
  onRestoreRevision: (region: ArrangementRegion, revisionId: string) => void
  onSaveDraft: (region: ArrangementRegion, draft: RegionEditorDraft, revisionLabel: string | null) => void
  onSelectEvent: (eventId: string) => void
}

type PianoRollPanelContentProps = PianoRollPanelProps & {
  initialDraft: RegionEditorDraft | null
  revisionHistory: RegionRevisionEntry[]
  sourceDraft: RegionEditorDraft | null
  sourceSignature: string
}

export function PianoRollPanel(props: PianoRollPanelProps) {
  const sourceDraft = props.region ? createDraft(props.region) : null
  const sourceSignature = draftSignature(sourceDraft)
  const initialDraft = readStoredDraft(props.draftStorageKey ?? null, sourceDraft, sourceSignature)
  const revisionHistory = getRevisionHistory(props.region)
  const editorKey = `${props.region?.region_id ?? 'empty'}:${sourceSignature}:${draftSignature(initialDraft)}`

  return (
    <PianoRollPanelContent
      {...props}
      key={editorKey}
      initialDraft={initialDraft}
      revisionHistory={revisionHistory}
      sourceDraft={sourceDraft}
      sourceSignature={sourceSignature}
    />
  )
}

function PianoRollPanelContent({
  bpm,
  draftStorageKey,
  disabled,
  disabledReason,
  focusedEventId,
  gridSeconds,
  region,
  selectedEventId,
  tracks,
  onRestoreRevision,
  onSaveDraft,
  onSelectEvent,
  initialDraft,
  revisionHistory,
  sourceDraft,
  sourceSignature,
}: PianoRollPanelContentProps) {
  const [draft, setDraft] = useState<RegionEditorDraft | null>(initialDraft)
  const [undoStack, setUndoStack] = useState<RegionEditorDraft[]>([])
  const [redoStack, setRedoStack] = useState<RegionEditorDraft[]>([])
  const [revisionLabel, setRevisionLabel] = useState('구간 편집 저장')
  const [selectedRevisionId, setSelectedRevisionId] = useState(revisionHistory[0]?.revision_id ?? '')

  const hasDirtyChanges = draftSignature(draft) !== sourceSignature
  const events = getRenderableMiniEvents(draft?.events ?? [])
  const selectedEvent =
    events.find((event) => event.event_id === selectedEventId) ??
    events.find((event) => event.event_id === focusedEventId) ??
    events[0] ??
    null
  const pitchLabels = ['높음', '', '중간', '', '낮음']

  function replaceDraft(nextDraft: RegionEditorDraft) {
    setDraft((previousDraft) => {
      if (previousDraft && draftSignature(previousDraft) !== draftSignature(nextDraft)) {
        setUndoStack((stack) => [...stack.slice(-(MAX_UNDO_STEPS - 1)), previousDraft])
        setRedoStack([])
      }
      return nextDraft
    })
  }

  function patchDraft(patch: Partial<RegionEditorDraft>) {
    if (!draft) {
      return
    }
    replaceDraft({ ...draft, ...patch })
  }

  function patchEvent(eventId: string, patch: Partial<RegionEditorDraftEvent>) {
    if (!draft) {
      return
    }
    replaceDraft({
      ...draft,
      events: draft.events.map((event) => (event.event_id === eventId ? { ...event, ...patch } : event)),
    })
  }

  function moveRegionStart(nextStartSeconds: number) {
    if (!draft) {
      return
    }
    const nextStart = clampTimelineStart(nextStartSeconds)
    const deltaSeconds = nextStart - draft.start_seconds
    replaceDraft({
      ...draft,
      events: draft.events.map((event) => ({
        ...event,
        start_seconds: clampTimelineStart(event.start_seconds + deltaSeconds),
      })),
      start_seconds: nextStart,
    })
  }

  function undoDraft() {
    const previousDraft = undoStack.at(-1)
    if (!previousDraft || !draft) {
      return
    }
    setUndoStack((stack) => stack.slice(0, -1))
    setRedoStack((stack) => [...stack, draft])
    setDraft(previousDraft)
  }

  function redoDraft() {
    const nextDraft = redoStack.at(-1)
    if (!nextDraft || !draft) {
      return
    }
    setRedoStack((stack) => stack.slice(0, -1))
    setUndoStack((stack) => [...stack, draft])
    setDraft(nextDraft)
  }

  function resetDraft() {
    clearStoredDraft(draftStorageKey ?? null)
    setDraft(sourceDraft)
    setUndoStack([])
    setRedoStack([])
  }

  function snapSelectedEvent() {
    if (!draft || !selectedEvent) {
      return
    }
    patchEvent(selectedEvent.event_id, {
      duration_seconds: Math.max(gridSeconds, roundSeconds(roundToGrid(selectedEvent.duration_seconds, gridSeconds))),
      start_seconds: clampTimelineStart(roundToGrid(selectedEvent.start_seconds, gridSeconds)),
    })
  }

  function saveDraft() {
    if (!region || !draft) {
      return
    }
    onSaveDraft(region, draft, revisionLabel.trim() || null)
  }

  useEffect(() => {
    if (!draftStorageKey) {
      return
    }
    if (!draft || !hasDirtyChanges) {
      clearStoredDraft(draftStorageKey)
      return
    }
    writeStoredDraft(draftStorageKey, sourceSignature, draft)
  }, [draft, draftStorageKey, hasDirtyChanges, sourceSignature])

  return (
    <section className="piano-roll-panel" aria-label="구간 편집기">
      <header>
        <div>
          <p className="eyebrow">구간 편집</p>
          <h3>{region ? `${selectedTrackName(tracks, draft?.target_track_slot_id ?? region.track_slot_id)} 구간 편집` : '구간 선택'}</h3>
        </div>
        <div className="piano-roll-panel__tools" aria-label="편집 도구">
          {disabled && disabledReason ? <span className="piano-roll-panel__lock">{disabledReason}</span> : null}
          <button disabled={disabled || !hasDirtyChanges} type="button" onClick={saveDraft} data-testid="save-region-draft-button">
            저장
          </button>
          <button disabled={!hasDirtyChanges} type="button" onClick={resetDraft}>
            초기화
          </button>
          <button disabled={undoStack.length === 0} type="button" onClick={undoDraft}>
            되돌리기
          </button>
          <button disabled={redoStack.length === 0} type="button" onClick={redoDraft}>
            다시 실행
          </button>
        </div>
      </header>

      {hasDirtyChanges ? (
        <p className="draft-save-notice">
          저장 전 변경사항은 이 브라우저에 임시 저장됩니다. 저장하면 다른 화면에도 반영되고, 초기화하면 마지막 저장 상태로 돌아갑니다.
        </p>
      ) : null}

      {!region || !draft ? (
        <p className="piano-roll-panel__hint">구간을 선택하면 세부 값을 수정할 수 있습니다.</p>
      ) : (
        <>
          <div className="region-draft-grid" aria-label="구간 설정">
            <label className="editor-field">
              <span>파트</span>
              <select
                disabled={disabled}
                value={draft.target_track_slot_id}
                onChange={(event) => patchDraft({ target_track_slot_id: Number(event.currentTarget.value) })}
              >
                {tracks.map((track) => (
                  <option key={track.slot_id} value={track.slot_id}>
                    {formatTrackName(track.name)}
                  </option>
                ))}
              </select>
            </label>
            <FieldNumber
              disabled={disabled}
              label="시작 위치"
              min={MIN_TIMELINE_SECONDS}
              step={0.001}
              value={draft.start_seconds}
              onChange={moveRegionStart}
            />
            <FieldNumber
              disabled={disabled}
              label="길이"
              min={MIN_DURATION_SECONDS}
              step={0.001}
              value={draft.duration_seconds}
              onChange={(value) => patchDraft({ duration_seconds: clampDuration(value) })}
            />
            <FieldNumber
              disabled={disabled}
              label="음량"
              max={100}
              min={0}
              step={1}
              value={draft.volume_percent}
              onChange={(value) => patchDraft({ volume_percent: clampVolume(value) })}
            />
            <label className="editor-field editor-field--wide">
              <span>이름</span>
              <input
                disabled={disabled}
                maxLength={180}
                type="text"
                value={draft.source_label}
                onChange={(event) => patchDraft({ source_label: event.currentTarget.value })}
              />
            </label>
          </div>

          <div className="piano-roll">
            <div className="piano-roll__keys" aria-hidden="true">
              {pitchLabels.map((label, index) => (
                <span key={`${index}-${label || 'guide'}`}>{label}</span>
              ))}
            </div>
            <div className="piano-roll__grid">
              {events.length > 0 ? (
                events.map((event) => (
                  <button
                    aria-pressed={event.event_id === selectedEvent?.event_id}
                    className={`piano-roll__event ${
                      event.event_id === focusedEventId || event.event_id === selectedEvent?.event_id
                        ? 'is-focused'
                        : ''
                    }`}
                    data-testid={`piano-event-${event.event_id}`}
                    key={event.event_id}
                    style={
                      {
                        '--event-left': `${getEventLeftPercent(event, draft.start_seconds, draft.duration_seconds)}%`,
                        '--event-top': `${getEventMiniTopPercent(event, events)}%`,
                        '--event-width': `${getEventWidthPercent(event, draft.duration_seconds)}%`,
                      } as CSSProperties
                    }
                    title={getEventMiniTitle(event)}
                    aria-label={getEventMiniAriaLabel(event)}
                    type="button"
                    onClick={() => onSelectEvent(event.event_id)}
                  >
                    <span className="event-mini__sr">{event.label}</span>
                  </button>
                ))
              ) : (
                <p>편집할 구간을 선택하세요.</p>
              )}
            </div>
          </div>

          {selectedEvent ? (
            <section className="event-inspector" aria-label="선택한 음 편집">
              <header>
                <div>
                  <p className="eyebrow">선택한 음</p>
                  <h4>{selectedEvent.label}</h4>
                </div>
                <div className="event-inspector__buttons">
                  <button
                    disabled={disabled || selectedEvent.pitch_midi === null}
                    title="선택한 음을 반음 낮춥니다."
                    type="button"
                    onClick={() => {
                      if (selectedEvent.pitch_midi !== null) {
                        const nextPitch = clampMidi(selectedEvent.pitch_midi - 1)
                        patchEvent(selectedEvent.event_id, { label: midiToLabel(nextPitch), pitch_midi: nextPitch })
                      }
                    }}
                  >
                    반음 내림
                  </button>
                  <button
                    disabled={disabled || selectedEvent.pitch_midi === null}
                    title="선택한 음을 반음 높입니다."
                    type="button"
                    onClick={() => {
                      if (selectedEvent.pitch_midi !== null) {
                        const nextPitch = clampMidi(selectedEvent.pitch_midi + 1)
                        patchEvent(selectedEvent.event_id, { label: midiToLabel(nextPitch), pitch_midi: nextPitch })
                      }
                    }}
                  >
                    반음 올림
                  </button>
                  <button
                    disabled={disabled}
                    title={`선택한 음의 시작을 ${formatDurationSeconds(gridSeconds)} 앞당깁니다.`}
                    type="button"
                    onClick={() =>
                      patchEvent(selectedEvent.event_id, {
                        start_seconds: clampTimelineStart(selectedEvent.start_seconds - gridSeconds),
                      })
                    }
                  >
                    앞당기기
                  </button>
                  <button
                    disabled={disabled}
                    title={`선택한 음의 시작을 ${formatDurationSeconds(gridSeconds)} 늦춥니다.`}
                    type="button"
                    onClick={() =>
                      patchEvent(selectedEvent.event_id, {
                        start_seconds: clampTimelineStart(selectedEvent.start_seconds + gridSeconds),
                      })
                    }
                  >
                    늦추기
                  </button>
                  <button
                    disabled={disabled}
                    title={`시작과 길이를 가장 가까운 ${formatDurationSeconds(gridSeconds)} 단위로 맞춥니다.`}
                    type="button"
                    onClick={snapSelectedEvent}
                  >
                    박자 맞춤
                  </button>
                  <button
                    disabled={disabled}
                    title="선택한 음을 소리 나지 않게 합니다. 저장 전에는 되돌리기로 복구할 수 있습니다."
                    type="button"
                    onClick={() =>
                      patchEvent(selectedEvent.event_id, {
                        is_rest: true,
                        label: 'Rest',
                        pitch_midi: null,
                      })
                    }
                  >
                    음 제거
                  </button>
                </div>
              </header>
              <div className="event-inspector__grid">
                <FieldNumber
                  companionTestId="selected-midi-note-name"
                  companionText={midiToLabel(selectedEvent.pitch_midi ?? 60)}
                  disabled={disabled}
                  label="음높이"
                  max={127}
                  min={0}
                  step={1}
                  value={selectedEvent.pitch_midi ?? 60}
                  onChange={(value) => {
                    const nextPitch = clampMidi(value)
                    patchEvent(selectedEvent.event_id, {
                      is_rest: false,
                      label: midiToLabel(nextPitch),
                      pitch_midi: nextPitch,
                    })
                  }}
                />
                <FieldNumber
                  disabled={disabled}
                  label="시작 시간"
                  min={MIN_TIMELINE_SECONDS}
                  step={0.001}
                  value={selectedEvent.start_seconds}
                  onChange={(value) =>
                    patchEvent(selectedEvent.event_id, { start_seconds: clampTimelineStart(value) })
                  }
                />
                <FieldNumber
                  disabled={disabled}
                  label="길이"
                  min={MIN_DURATION_SECONDS}
                  step={0.001}
                  value={selectedEvent.duration_seconds}
                  onChange={(value) =>
                    patchEvent(selectedEvent.event_id, { duration_seconds: clampDuration(value) })
                  }
                />
                <FieldNumber
                  disabled={disabled}
                  label="박자 위치"
                  min={0}
                  step={0.001}
                  value={startBeatForEvent(selectedEvent, draft, bpm)}
                  onChange={(value) =>
                    patchEvent(selectedEvent.event_id, {
                      start_seconds: clampTimelineStart(draft.start_seconds + ((value - 1) * beatSeconds(bpm))),
                    })
                  }
                />
                <FieldNumber
                  disabled={disabled}
                  label="박자 길이"
                  min={0.001}
                  step={0.001}
                  value={durationBeatsForEvent(selectedEvent, bpm)}
                  onChange={(value) =>
                    patchEvent(selectedEvent.event_id, {
                      duration_seconds: clampDuration(value * beatSeconds(bpm)),
                    })
                  }
                />
              </div>
            </section>
          ) : null}

          <section className="revision-panel" aria-label="버전 기록">
            <div className="revision-panel__intro">
              <p className="eyebrow">버전 기록</p>
              <h4>{revisionHistory.length > 0 ? `${revisionHistory.length}개 저장됨` : '아직 저장된 버전 없음'}</h4>
              <p>
                저장하면 이전 상태가 이 구간의 복원 지점으로 남습니다.
              </p>
            </div>
            <label className="editor-field editor-field--wide">
              <span>저장 메모</span>
              <input
                maxLength={120}
                type="text"
                value={revisionLabel}
                onChange={(event) => setRevisionLabel(event.currentTarget.value)}
              />
            </label>
            <div className="revision-panel__history">
              <h5>되돌릴 버전</h5>
              {revisionHistory.length > 0 ? (
                <div className="revision-panel__restore">
                  <select
                    value={selectedRevisionId}
                    onChange={(event) => setSelectedRevisionId(event.currentTarget.value)}
                  >
                    {revisionHistory.map((revision) => (
                      <option key={revision.revision_id} value={revision.revision_id}>
                        {revision.label} · {formatDateTime(revision.created_at)} · {revision.summary}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={disabled || !selectedRevisionId}
                    type="button"
                    onClick={() => onRestoreRevision(region, selectedRevisionId)}
                  >
                    이 버전으로 되돌리기
                  </button>
                </div>
              ) : (
                <p>저장 후 되돌릴 수 있는 버전이 여기에 표시됩니다.</p>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  )
}
