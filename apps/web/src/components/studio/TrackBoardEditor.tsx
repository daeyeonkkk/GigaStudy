import type { CSSProperties } from 'react'

import {
  formatDurationSeconds,
  formatTrackName,
  getPitchEventRange,
  getPitchedEvents,
} from '../../lib/studio'
import type {
  ArrangementRegion,
  PitchEvent,
  TrackSlot,
  UpdatePitchEventRequest,
} from '../../types/studio'
import { getDurationPercent } from './TrackBoardTimelineLayout'

const MIN_TIMELINE_SECONDS = -30

function getEventLeftPercent(event: PitchEvent, region: ArrangementRegion): number {
  return getDurationPercent(event.start_seconds - region.start_seconds, region.duration_seconds)
}

function getEventWidthPercent(event: PitchEvent, region: ArrangementRegion): number {
  return Math.max(1.4, getDurationPercent(event.duration_seconds, region.duration_seconds))
}

function getEventTopPercent(event: PitchEvent, events: PitchEvent[]): number {
  const pitchRange = getPitchEventRange(events)
  const midi = typeof event.pitch_midi === 'number' ? event.pitch_midi : pitchRange.minMidi
  const span = Math.max(1, pitchRange.maxMidi - pitchRange.minMidi)
  return Math.max(3, Math.min(91, ((pitchRange.maxMidi - midi) / span) * 88 + 3))
}

function roundToGrid(value: number, gridSeconds: number): number {
  return Math.round(value / gridSeconds) * gridSeconds
}

function clampTimelineStart(value: number): number {
  return Math.max(MIN_TIMELINE_SECONDS, Math.round(value * 1000) / 1000)
}

export function RegionTools({
  disabled,
  disabledReason,
  gridSeconds,
  region,
  tracks,
  onCopyRegion,
  onDeleteRegion,
  onMoveRegion,
  onSplitRegion,
}: {
  disabled: boolean
  disabledReason: string | null
  gridSeconds: number
  region: ArrangementRegion | null
  tracks: TrackSlot[]
  onCopyRegion: (region: ArrangementRegion, targetSlotId: number, startSeconds: number) => void
  onDeleteRegion: (region: ArrangementRegion) => void
  onMoveRegion: (region: ArrangementRegion, targetSlotId: number, startSeconds: number) => void
  onSplitRegion: (region: ArrangementRegion, splitSeconds: number) => void
}) {
  if (!region) {
    return <p className="piano-roll-panel__hint">편집할 구간을 선택하세요.</p>
  }

  const canMoveUp = region.track_slot_id > Math.min(...tracks.map((track) => track.slot_id))
  const canMoveDown = region.track_slot_id < Math.max(...tracks.map((track) => track.slot_id))
  const midpoint = region.start_seconds + region.duration_seconds / 2

  return (
    <div className="region-tools" aria-label="구간 편집 도구">
      {disabled && disabledReason ? <p className="region-tools__hint">{disabledReason}</p> : null}
      <button
        disabled={disabled}
        type="button"
        onClick={() => onMoveRegion(region, region.track_slot_id, clampTimelineStart(region.start_seconds - gridSeconds))}
      >
        왼쪽 이동
      </button>
      <button
        disabled={disabled}
        type="button"
        onClick={() => onMoveRegion(region, region.track_slot_id, clampTimelineStart(region.start_seconds + gridSeconds))}
      >
        오른쪽 이동
      </button>
      <button disabled={disabled} type="button" onClick={() => onSplitRegion(region, midpoint)}>
        자르기
      </button>
      <button
        disabled={disabled}
        type="button"
        onClick={() => onCopyRegion(region, region.track_slot_id, region.start_seconds + region.duration_seconds)}
      >
        복사
      </button>
      <button
        disabled={disabled || !canMoveUp}
        type="button"
        onClick={() => onMoveRegion(region, region.track_slot_id - 1, region.start_seconds)}
      >
        위 트랙
      </button>
      <button
        disabled={disabled || !canMoveDown}
        type="button"
        onClick={() => onMoveRegion(region, region.track_slot_id + 1, region.start_seconds)}
      >
        아래 트랙
      </button>
      <button className="region-tools__danger" disabled={disabled} type="button" onClick={() => onDeleteRegion(region)}>
        삭제
      </button>
    </div>
  )
}

export function PianoRollPanel({
  disabled,
  disabledReason,
  focusedEventId,
  gridSeconds,
  region,
  selectedEventId,
  onSelectEvent,
  onUpdateEvent,
}: {
  disabled: boolean
  disabledReason: string | null
  focusedEventId?: string | null
  gridSeconds: number
  region: ArrangementRegion | null
  selectedEventId: string | null
  onSelectEvent: (eventId: string) => void
  onUpdateEvent: (region: ArrangementRegion, event: PitchEvent, patch: UpdatePitchEventRequest) => void
}) {
  const events = region ? getPitchedEvents(region.pitch_events) : []
  const selectedEvent =
    events.find((event) => event.event_id === selectedEventId) ??
    events.find((event) => event.event_id === focusedEventId) ??
    events[0] ??
    null
  const pitchRange = getPitchEventRange(events)
  const pitchLabels = Array.from({ length: 5 }, (_, index) => {
    const midi = Math.round(
      pitchRange.maxMidi - ((pitchRange.maxMidi - pitchRange.minMidi) / 4) * index,
    )
    return `M${midi}`
  })

  function updateSelectedEvent(patch: UpdatePitchEventRequest) {
    if (!region || !selectedEvent) {
      return
    }
    onUpdateEvent(region, selectedEvent, patch)
  }

  return (
    <section className="piano-roll-panel" aria-label="음표 세부 편집기">
      <header>
        <div>
          <p className="eyebrow">세부 편집</p>
          <h3>{region ? `${formatTrackName(region.track_name)} 음표 편집` : '음표 편집'}</h3>
        </div>
        <div className="piano-roll-panel__tools" aria-label="음표 편집 도구">
          {disabled && disabledReason ? <span className="piano-roll-panel__lock">{disabledReason}</span> : null}
          <button
            disabled={disabled || !selectedEvent}
            type="button"
            onClick={() => {
              if (selectedEvent?.pitch_midi !== null && selectedEvent?.pitch_midi !== undefined) {
                updateSelectedEvent({ pitch_midi: Math.max(0, selectedEvent.pitch_midi - 1) })
              }
            }}
          >
            음정 -
          </button>
          <button
            disabled={disabled || !selectedEvent}
            type="button"
            onClick={() => {
              if (selectedEvent?.pitch_midi !== null && selectedEvent?.pitch_midi !== undefined) {
                updateSelectedEvent({ pitch_midi: Math.min(127, selectedEvent.pitch_midi + 1) })
              }
            }}
          >
            음정 +
          </button>
          <button
            disabled={disabled || !selectedEvent}
            type="button"
            onClick={() =>
              selectedEvent
                ? updateSelectedEvent({
                    start_seconds: clampTimelineStart(selectedEvent.start_seconds - gridSeconds),
                  })
                : undefined
            }
          >
            당기기
          </button>
          <button
            disabled={disabled || !selectedEvent}
            type="button"
            onClick={() =>
              selectedEvent
                ? updateSelectedEvent({
                    start_seconds: clampTimelineStart(selectedEvent.start_seconds + gridSeconds),
                  })
                : undefined
            }
          >
            밀기
          </button>
          <button
            disabled={disabled || !selectedEvent}
            type="button"
            onClick={() =>
              selectedEvent
                ? updateSelectedEvent({
                    duration_seconds: Math.max(0.08, selectedEvent.duration_seconds - gridSeconds),
                  })
                : undefined
            }
          >
            짧게
          </button>
          <button
            disabled={disabled || !selectedEvent}
            type="button"
            onClick={() =>
              selectedEvent
                ? updateSelectedEvent({
                    duration_seconds: selectedEvent.duration_seconds + gridSeconds,
                  })
                : undefined
            }
          >
            길게
          </button>
          <button
            disabled={disabled || !selectedEvent}
            type="button"
            onClick={() =>
              selectedEvent
                ? updateSelectedEvent({
                    duration_seconds: Math.max(gridSeconds, roundToGrid(selectedEvent.duration_seconds, gridSeconds)),
                    start_seconds: clampTimelineStart(roundToGrid(selectedEvent.start_seconds, gridSeconds)),
                  })
                : undefined
            }
          >
            스냅
          </button>
        </div>
      </header>

      <div className="piano-roll">
        <div className="piano-roll__keys" aria-hidden="true">
          {pitchLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="piano-roll__grid">
          {region && events.length > 0 ? (
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
                    '--event-left': `${getEventLeftPercent(event, region)}%`,
                    '--event-top': `${getEventTopPercent(event, events)}%`,
                    '--event-width': `${getEventWidthPercent(event, region)}%`,
                  } as CSSProperties
                }
                title={`${event.label} - ${formatDurationSeconds(event.duration_seconds)}`}
                type="button"
                onClick={() => onSelectEvent(event.event_id)}
              >
                {event.label}
              </button>
            ))
          ) : (
            <p>음표가 있는 구간을 선택하세요.</p>
          )}
        </div>
      </div>
    </section>
  )
}
