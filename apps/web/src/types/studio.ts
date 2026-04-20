export type TrackStatus =
  | 'empty'
  | 'recording'
  | 'uploading'
  | 'extracting'
  | 'generating'
  | 'needs_review'
  | 'registered'
  | 'failed'

export type SourceKind = 'recording' | 'audio' | 'midi' | 'score' | 'music' | 'ai'
export type NoteSource = 'musicxml' | 'midi' | 'omr' | 'voice' | 'ai' | 'recording' | 'audio' | 'fixture'

export type ScoreNote = {
  id: string
  pitch_midi: number | null
  pitch_hz: number | null
  label: string
  onset_seconds: number
  duration_seconds: number
  beat: number
  duration_beats: number
  measure_index: number | null
  beat_in_measure: number | null
  confidence: number
  source: NoteSource
  extraction_method: string
  is_rest: boolean
  is_tied: boolean
  voice_index: number | null
  staff_index: number | null
}

export type TrackExtractionJob = {
  job_id: string
  slot_id: number
  source_kind: SourceKind
  source_label: string
  status: 'queued' | 'running' | 'needs_review' | 'completed' | 'failed'
  method: string
  message: string | null
  input_path: string | null
  output_path: string | null
  created_at: string
  updated_at: string
}

export type ExtractionCandidate = {
  candidate_id: string
  candidate_group_id: string | null
  suggested_slot_id: number
  source_kind: SourceKind
  source_label: string
  method: string
  variant_label: string | null
  confidence: number
  status: 'pending' | 'approved' | 'rejected'
  notes: ScoreNote[]
  job_id: string | null
  message: string | null
  created_at: string
  updated_at: string
}

export type TrackSlot = {
  slot_id: number
  name: string
  status: TrackStatus
  sync_offset_seconds: number
  source_kind: SourceKind | null
  source_label: string | null
  duration_seconds: number
  notes: ScoreNote[]
  updated_at: string
}

export type ReportIssue = {
  at_seconds: number
  issue_type: 'pitch' | 'rhythm' | 'pitch_rhythm' | 'missing' | 'extra'
  severity: 'info' | 'warn' | 'error'
  answer_note_id: string | null
  performance_note_id: string | null
  answer_label: string | null
  performance_label: string | null
  expected_at_seconds: number | null
  actual_at_seconds: number | null
  timing_error_seconds: number | null
  pitch_error_semitones: number | null
  message: string | null
  correction_hint: string | null
}

export type ScoringReport = {
  report_id: string
  target_slot_id: number
  target_track_name: string
  reference_slot_ids: number[]
  include_metronome: boolean
  created_at: string
  answer_note_count: number
  performance_note_count: number
  matched_note_count: number
  missing_note_count: number
  extra_note_count: number
  alignment_offset_seconds: number
  overall_score: number
  pitch_score: number
  rhythm_score: number
  mean_abs_pitch_error_semitones: number | null
  mean_abs_timing_error_seconds: number | null
  pitch_summary: string
  rhythm_summary: string
  issues: ReportIssue[]
}

export type Studio = {
  studio_id: string
  title: string
  bpm: number
  time_signature_numerator: number
  time_signature_denominator: number
  tracks: TrackSlot[]
  reports: ScoringReport[]
  jobs: TrackExtractionJob[]
  candidates: ExtractionCandidate[]
  created_at: string
  updated_at: string
}

export type StudioListItem = {
  studio_id: string
  title: string
  bpm: number
  time_signature_numerator: number
  time_signature_denominator: number
  registered_track_count: number
  report_count: number
  updated_at: string
}

export type CreateStudioRequest = {
  title: string
  bpm: number
  time_signature_numerator?: number
  time_signature_denominator?: number
  start_mode: 'blank' | 'upload'
  source_kind?: 'score' | 'music'
  source_filename?: string
  source_content_base64?: string
}
