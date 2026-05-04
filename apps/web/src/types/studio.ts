type TrackStatus =
  | 'empty'
  | 'recording'
  | 'uploading'
  | 'extracting'
  | 'generating'
  | 'needs_review'
  | 'registered'
  | 'failed'

export type SourceKind = 'recording' | 'audio' | 'midi' | 'document' | 'music' | 'ai'
export type PitchEventSource = 'musicxml' | 'midi' | 'document' | 'voice' | 'ai' | 'recording' | 'audio'
export type ScoreMode = 'answer' | 'harmony'

export type PitchEvent = {
  event_id: string
  track_slot_id: number
  region_id: string
  label: string
  pitch_midi: number | null
  pitch_hz: number | null
  start_seconds: number
  duration_seconds: number
  start_beat: number
  duration_beats: number
  confidence: number
  source: PitchEventSource
  extraction_method: string
  is_rest: boolean
  measure_index: number | null
  beat_in_measure: number | null
  quality_warnings: string[]
}

export type TempoChange = {
  measure_index: number
  bpm: number
}

export type ArrangementRegion = {
  region_id: string
  track_slot_id: number
  track_name: string
  source_kind: SourceKind | null
  source_label: string | null
  audio_source_path: string | null
  audio_mime_type: string | null
  start_seconds: number
  duration_seconds: number
  sync_offset_seconds: number
  volume_percent: number
  pitch_events: PitchEvent[]
  diagnostics: Record<string, unknown>
}

export type UpdateRegionRequest = {
  target_track_slot_id?: number | null
  start_seconds?: number | null
  duration_seconds?: number | null
  volume_percent?: number | null
  source_label?: string | null
}

export type CopyRegionRequest = {
  target_track_slot_id?: number | null
  start_seconds?: number | null
}

export type SplitRegionRequest = {
  split_seconds: number
}

export type UpdatePitchEventRequest = {
  label?: string | null
  pitch_midi?: number | null
  start_seconds?: number | null
  duration_seconds?: number | null
  start_beat?: number | null
  duration_beats?: number | null
  confidence?: number | null
  is_rest?: boolean | null
}

export type SaveRegionEventPatch = UpdatePitchEventRequest & {
  event_id: string
}

export type SaveRegionRevisionRequest = UpdateRegionRequest & {
  events?: SaveRegionEventPatch[]
  revision_label?: string | null
}

export type CandidateRegion = {
  region_id: string
  suggested_slot_id: number
  source_kind: SourceKind
  source_label: string
  start_seconds: number
  duration_seconds: number
  pitch_events: PitchEvent[]
  diagnostics: Record<string, unknown>
}

export type TrackExtractionJob = {
  job_id: string
  job_type: 'document' | 'voice'
  slot_id: number
  source_kind: SourceKind
  source_label: string
  status: 'queued' | 'running' | 'needs_review' | 'completed' | 'failed'
  method: string
  message: string | null
  input_path: string | null
  output_path: string | null
  attempt_count: number
  max_attempts: number
  parse_all_parts: boolean
  use_source_tempo: boolean
  review_before_register: boolean
  allow_overwrite: boolean
  audio_mime_type: string | null
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
  audio_source_path: string | null
  audio_source_label: string | null
  audio_mime_type: string | null
  job_id: string | null
  message: string | null
  diagnostics: Record<string, unknown>
  region: CandidateRegion
  created_at: string
  updated_at: string
}

export type TrackSlot = {
  slot_id: number
  name: string
  status: TrackStatus
  sync_offset_seconds: number
  volume_percent: number
  source_kind: SourceKind | null
  source_label: string | null
  audio_source_path: string | null
  audio_source_label: string | null
  audio_mime_type: string | null
  duration_seconds: number
  diagnostics: Record<string, unknown>
  updated_at: string
}

export type ReportIssue = {
  at_seconds: number
  issue_type:
    | 'pitch'
    | 'rhythm'
    | 'pitch_rhythm'
    | 'missing'
    | 'extra'
    | 'harmony'
    | 'chord_fit'
    | 'range'
    | 'spacing'
    | 'voice_leading'
    | 'crossing'
    | 'parallel_motion'
    | 'tension_resolution'
    | 'bass_foundation'
    | 'chord_coverage'
  severity: 'info' | 'warn' | 'error'
  answer_source_event_id: string | null
  performance_source_event_id: string | null
  answer_region_id: string | null
  answer_event_id: string | null
  performance_region_id: string | null
  performance_event_id: string | null
  answer_label: string | null
  performance_label: string | null
  expected_at_seconds: number | null
  actual_at_seconds: number | null
  expected_beat: number | null
  actual_beat: number | null
  timing_error_seconds: number | null
  pitch_error_semitones: number | null
  message: string | null
  correction_hint: string | null
}

export type ScoringReport = {
  report_id: string
  score_mode: ScoreMode
  target_slot_id: number
  target_track_name: string
  reference_slot_ids: number[]
  include_metronome: boolean
  created_at: string
  answer_event_count: number
  performance_event_count: number
  matched_event_count: number
  missing_event_count: number
  extra_event_count: number
  alignment_offset_seconds: number
  overall_score: number
  pitch_score: number
  rhythm_score: number
  harmony_score: number | null
  chord_fit_score: number | null
  range_score: number | null
  spacing_score: number | null
  voice_leading_score: number | null
  arrangement_score: number | null
  mean_abs_pitch_error_semitones: number | null
  mean_abs_timing_error_seconds: number | null
  pitch_summary: string
  rhythm_summary: string
  harmony_summary: string
  issues: ReportIssue[]
}

export type Studio = {
  studio_id: string
  is_active: boolean
  deactivated_at: string | null
  title: string
  bpm: number
  tempo_changes: TempoChange[]
  time_signature_numerator: number
  time_signature_denominator: number
  tracks: TrackSlot[]
  regions: ArrangementRegion[]
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
  bpm?: number
  time_signature_numerator?: number
  time_signature_denominator?: number
  start_mode: 'blank' | 'upload'
  source_kind?: 'document' | 'music'
  source_filename?: string
  source_content_base64?: string
  source_asset_path?: string
}

export type UpdateStudioTimingRequest = {
  bpm?: number | null
  tempo_changes?: TempoChange[] | null
}

export type PlaybackInstrumentConfig = {
  has_custom_file: boolean
  filename: string | null
  root_midi: number
  audio_url: string | null
  updated_at: string | null
}

export type DirectUploadTarget = {
  asset_id: string
  asset_path: string
  upload_url: string
  method: 'PUT'
  headers: Record<string, string>
  expires_at: string
  max_bytes: number
}

export type AdminAssetSummary = {
  asset_id: string
  studio_id: string
  kind: 'upload' | 'generated' | 'unknown'
  filename: string
  relative_path: string
  size_bytes: number
  updated_at: string
  referenced: boolean
}

export type AdminStudioSummary = {
  studio_id: string
  title: string
  is_active: boolean
  deactivated_at: string | null
  bpm: number
  registered_track_count: number
  report_count: number
  candidate_count: number
  job_count: number
  asset_count: number
  asset_bytes: number
  created_at: string
  updated_at: string
  assets: AdminAssetSummary[]
}

type AdminLimitSummary = {
  studio_soft_limit: number
  studio_hard_limit: number
  asset_warning_bytes: number
  asset_hard_bytes: number
  max_upload_bytes: number
  max_active_engine_jobs: number
  studio_warning: boolean
  studio_limit_reached: boolean
  asset_warning: boolean
  asset_limit_reached: boolean
  warnings: string[]
}

export type AdminStorageSummary = {
  storage_root: string
  studio_count: number
  active_studio_count: number
  inactive_studio_count: number
  studio_status: 'active' | 'inactive' | 'all'
  listed_studio_count: number
  studio_limit: number
  studio_offset: number
  has_more_studios: boolean
  asset_limit: number
  asset_offset: number
  asset_count: number
  listed_asset_count: number
  total_asset_bytes: number
  total_bytes: number
  metadata_bytes: number
  limits: AdminLimitSummary
  studios: AdminStudioSummary[]
}

export type AdminDeleteResult = {
  deleted: boolean
  message: string
  studio_id: string | null
  asset_id: string | null
  deleted_files: number
  deleted_bytes: number
  cleanup_queued: boolean
}

export type AdminEngineDrainResult = {
  processed_jobs: number
  remaining_runnable: boolean
  max_jobs: number
  messages: string[]
}
