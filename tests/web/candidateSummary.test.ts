import { describe, expect, it } from 'vitest'

import { getCandidateDecisionSummary } from '../../apps/web/src/lib/studio/candidateSummary'
import type { ExtractionCandidate, PitchEvent, TrackSlot } from '../../apps/web/src/types/studio'

function buildPitchEvent(overrides: Partial<PitchEvent> = {}): PitchEvent {
  return {
    beat_in_measure: 1,
    confidence: 1,
    duration_beats: 1,
    duration_seconds: 0.5,
    event_id: 'event-1',
    extraction_method: 'midi_import',
    is_rest: false,
    label: 'C5',
    measure_index: 1,
    pitch_hz: null,
    pitch_midi: 72,
    quality_warnings: [],
    region_id: 'candidate-region-1',
    source: 'midi',
    start_beat: 1,
    start_seconds: 0,
    track_slot_id: 1,
    ...overrides,
  }
}

function buildCandidate(overrides: Partial<ExtractionCandidate> = {}): ExtractionCandidate {
  const pitchEvents = [buildPitchEvent()]
  return {
    audio_mime_type: null,
    audio_source_label: null,
    audio_source_path: null,
    candidate_group_id: null,
    candidate_id: 'candidate-1',
    confidence: 0.68,
    created_at: '2026-05-05T00:00:00Z',
    diagnostics: {},
    job_id: null,
    message: null,
    method: 'midi_seed_review',
    region: {
      diagnostics: {},
      duration_seconds: 0.5,
      pitch_events: pitchEvents,
      region_id: 'candidate-region-1',
      source_kind: 'midi',
      source_label: 'named-empty.mid',
      start_seconds: 0,
      suggested_slot_id: 1,
    },
    source_kind: 'midi',
    source_label: 'named-empty.mid',
    status: 'pending',
    suggested_slot_id: 1,
    updated_at: '2026-05-05T00:00:00Z',
    variant_label: null,
    ...overrides,
  }
}

const sopranoTrack: TrackSlot = {
  audio_mime_type: null,
  audio_source_label: null,
  audio_source_path: null,
  diagnostics: {},
  duration_seconds: 0,
  name: 'Soprano',
  source_kind: null,
  source_label: null,
  slot_id: 1,
  status: 'empty',
  sync_offset_seconds: 0,
  updated_at: '2026-05-05T00:00:00Z',
  volume_percent: 100,
}

describe('candidate decision summary', () => {
  it('surfaces named empty MIDI parts in review diagnostics', () => {
    const summary = getCandidateDecisionSummary(
      buildCandidate({
        diagnostics: {
          midi_named_empty_parts: [
            {
              slot_id: 5,
              source_label: '베이스',
              source_track_index: 2,
              track_name: 'Bass',
            },
          ],
        },
      }),
      sopranoTrack,
      4,
    )

    expect(summary.diagnostics).toContainEqual({
      label: '빈 MIDI 파트',
      value: 'Bass(베이스): MIDI 트랙 이름은 있지만 note 이벤트가 없어 후보를 만들지 못했습니다.',
    })
  })
})
