import type { CSSProperties } from 'react'

import { formatTrackName, getPitchedEvents } from '../../lib/studio'
import type { ArrangementRegion } from '../../types/studio'
import {
  getDurationPercent,
  getTimelinePercent,
  type TimelineBounds,
} from './TrackBoardTimelineLayout'

function getPlayheadStyle(playheadSeconds: number | null, timelineBounds: TimelineBounds): CSSProperties {
  return {
    '--playhead-left': `${getTimelinePercent(playheadSeconds ?? 0, timelineBounds)}%`,
  } as CSSProperties
}

export function PracticeWaterfall({
  playheadSeconds,
  regions,
  timelineBounds,
}: {
  playheadSeconds: number | null
  regions: ArrangementRegion[]
  timelineBounds: TimelineBounds
}) {
  const events = regions.flatMap((region) =>
    getPitchedEvents(region.pitch_events).map((event) => ({ event, region })),
  )
  const laneSlotIds = Array.from(new Set(regions.map((region) => region.track_slot_id))).sort((left, right) => left - right)
  const rowCount = Math.max(1, laneSlotIds.length)

  return (
    <section className="practice-waterfall" aria-label="연습 미리보기">
      <header>
        <div>
          <p className="eyebrow">연습</p>
          <h3>미리보기</h3>
        </div>
        <span>{events.length}개 음표</span>
      </header>
      <div
        className="practice-waterfall__stage"
        style={
          {
            ...getPlayheadStyle(playheadSeconds, timelineBounds),
            '--waterfall-row-count': rowCount,
          } as CSSProperties
        }
      >
        <i className="practice-waterfall__playhead" aria-hidden="true" />
        {laneSlotIds.map((slotId, index) => {
          const region = regions.find((item) => item.track_slot_id === slotId)
          return (
            <div
              className="practice-waterfall__lane"
              key={slotId}
              style={{ '--waterfall-row-index': index } as CSSProperties}
            >
              <span>{formatTrackName(region?.track_name)}</span>
            </div>
          )
        })}
        {events.map(({ event, region }) => (
          <i
            aria-label={`${formatTrackName(region.track_name)} ${event.label}`}
            className="practice-waterfall__note"
            key={`${region.region_id}-${event.event_id}`}
            style={
              {
                '--waterfall-left': `${getTimelinePercent(event.start_seconds, timelineBounds)}%`,
                '--waterfall-row-index': laneSlotIds.indexOf(region.track_slot_id),
                '--waterfall-width': `${getDurationPercent(event.duration_seconds, timelineBounds.durationSeconds)}%`,
              } as CSSProperties
            }
            title={`${formatTrackName(region.track_name)} - ${event.label}`}
          />
        ))}
      </div>
    </section>
  )
}
