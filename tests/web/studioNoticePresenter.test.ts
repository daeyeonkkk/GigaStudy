import { describe, expect, it } from 'vitest'

import {
  buildJobNotice,
  buildPollingDelayNotice,
  getNoticeProgressPercent,
  noticeHasMetaLanguage,
  NOTICE_META_BLOCKLIST,
  sanitizeNoticeText,
} from '../../apps/web/src/components/studio/studioNoticePresenter'
import type { StudioActionState } from '../../apps/web/src/components/studio/studioActionState'
import type { TrackExtractionJob } from '../../apps/web/src/types/studio'

const baseJob: TrackExtractionJob = {
  allow_overwrite: false,
  attempt_count: 0,
  audio_mime_type: null,
  created_at: '2026-05-07T00:00:00Z',
  diagnostics: {},
  input_path: null,
  job_id: 'job-1',
  job_type: 'document',
  max_attempts: 3,
  message: null,
  method: 'audiveris_cli',
  output_path: null,
  parse_all_parts: true,
  progress: null,
  review_before_register: false,
  slot_id: 1,
  source_kind: 'document',
  source_label: 'score.musicxml',
  status: 'running',
  updated_at: '2026-05-07T00:00:01Z',
  use_source_tempo: false,
}

function visibleNoticeText(notice: StudioActionState): string {
  if (notice.phase === 'idle') {
    return ''
  }
  return [notice.message, notice.detail].filter(Boolean).join(' ')
}

function expectUserFacingNotice(notice: StudioActionState) {
  const visibleText = visibleNoticeText(notice)
  for (const blocked of NOTICE_META_BLOCKLIST) {
    expect(visibleText).not.toContain(blocked)
  }
}

describe('studio notice presenter', () => {
  it('shows real progress only when a job has completed and total units', () => {
    const job: TrackExtractionJob = {
      ...baseJob,
      progress: {
        completed_units: 2,
        estimated_seconds_remaining: null,
        stage: 'registering',
        stage_label: '트랙에 등록하고 있습니다.',
        total_units: 5,
        unit_label: '파트',
        updated_at: '2026-05-07T00:00:03Z',
      },
    }

    const notice = buildJobNotice([job], Date.parse('2026-05-07T00:00:05Z'))

    expect(getNoticeProgressPercent(job)).toBe(40)
    expect(notice.phase).toBe('busy')
    if (notice.phase === 'busy') {
      expect(notice.progressPercent).toBe(40)
      expect(notice.detail).toContain('2/5파트 완료')
    }
    expectUserFacingNotice(notice)
  })

  it('does not invent percent for voice, generation, or scoring jobs', () => {
    for (const jobType of ['voice', 'generation', 'scoring'] as const) {
      const notice = buildJobNotice([
        {
          ...baseJob,
          job_type: jobType,
          parse_all_parts: false,
          progress: {
            completed_units: null,
            estimated_seconds_remaining: null,
            stage: jobType === 'scoring' ? 'scoring' : 'analyzing',
            stage_label:
              jobType === 'voice'
                ? '녹음파일에서 음을 찾고 있습니다.'
                : jobType === 'generation'
                  ? '선택한 기준 트랙을 바탕으로 새 성부를 만드는 중입니다.'
                  : '녹음한 연주를 기준 트랙과 맞춰보는 중입니다.',
            total_units: null,
            unit_label: null,
            updated_at: '2026-05-07T00:00:03Z',
          },
        },
      ])

      expect(notice.phase).toBe('busy')
      if (notice.phase === 'busy') {
        expect(notice.progressPercent).toBeUndefined()
        expect(notice.detail).toContain('예상 소요')
      }
      expectUserFacingNotice(notice)
    }
  })

  it('keeps short polling failures as warnings before escalating', () => {
    const warning = buildPollingDelayNotice(1)
    const error = buildPollingDelayNotice(3)

    expect(warning.phase).toBe('warning')
    expect(error.phase).toBe('error')
    expectUserFacingNotice(warning)
    expectUserFacingNotice(error)
  })

  it('sanitizes technical wording before it reaches the public notice line', () => {
    expect(noticeHasMetaLanguage('API 서버에 연결하지 못했습니다.')).toBe(true)
    expect(sanitizeNoticeText('API 서버에 연결하지 못했습니다.', 'error')).toBe(
      '연결이 잠시 불안정합니다. 잠시 뒤 다시 확인해 주세요.',
    )
  })
})
