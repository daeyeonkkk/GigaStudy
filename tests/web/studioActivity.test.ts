import { describe, expect, it } from 'vitest'

import {
  activeJobs,
  getActivityPollingDelayMs,
  shouldRefreshStudioFromActivity,
} from '../../apps/web/src/components/studio/useStudioResource'
import type { Studio, StudioActivity, TrackExtractionJob } from '../../apps/web/src/types/studio'

const baseJob: TrackExtractionJob = {
  allow_overwrite: false,
  attempt_count: 0,
  audio_mime_type: null,
  created_at: '2026-05-06T00:00:00Z',
  diagnostics: {},
  input_path: null,
  job_id: 'job-1',
  job_type: 'voice',
  max_attempts: 3,
  message: null,
  method: 'voice_transcription',
  output_path: null,
  parse_all_parts: false,
  review_before_register: false,
  slot_id: 1,
  source_kind: 'audio',
  source_label: 'take.wav',
  status: 'queued',
  updated_at: '2026-05-06T00:00:00Z',
  use_source_tempo: false,
}

const studio = {
  candidates: [],
  reports: [],
  studio_id: 'studio-1',
  tracks: [{ status: 'registered' }, { status: 'empty' }],
} as Studio

function activity(update: Partial<StudioActivity> = {}): StudioActivity {
  return {
    jobs: [baseJob],
    pending_candidate_count: 0,
    registered_track_count: 1,
    report_count: 0,
    studio_id: 'studio-1',
    updated_at: '2026-05-06T00:00:01Z',
    ...update,
  }
}

describe('studio activity polling helpers', () => {
  it('polls activity without a full refresh while only job status is active', () => {
    expect(activeJobs([baseJob])).toHaveLength(1)
    expect(shouldRefreshStudioFromActivity(studio, activity(), 1)).toBe(false)
  })

  it('requests one full refresh when user-visible counts change', () => {
    expect(shouldRefreshStudioFromActivity(studio, activity({ pending_candidate_count: 1 }), 1)).toBe(true)
    expect(shouldRefreshStudioFromActivity(studio, activity({ report_count: 1 }), 1)).toBe(true)
    expect(shouldRefreshStudioFromActivity(studio, activity({ registered_track_count: 2 }), 1)).toBe(true)
  })

  it('backs off queued polling and keeps running jobs responsive', () => {
    expect(getActivityPollingDelayMs([baseJob], 0)).toBe(2500)
    expect(getActivityPollingDelayMs([baseJob], 4)).toBe(5000)
    expect(getActivityPollingDelayMs([{ ...baseJob, status: 'running' }], 8)).toBe(1200)
    expect(getActivityPollingDelayMs([{ ...baseJob, status: 'completed' }], 8)).toBe(0)
  })
})
