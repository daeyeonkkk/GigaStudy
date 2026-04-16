export type ProjectChordTimelineItem = {
  start_ms: number
  end_ms: number
  label: string | null
  root: string | null
  quality: string | null
  pitch_classes: number[] | null
}

export type Project = {
  project_id: string
  title: string
  bpm: number | null
  base_key: string | null
  time_signature: string | null
  mode: string | null
  chord_timeline_json: ProjectChordTimelineItem[] | null
  created_at: string
  updated_at: string
}

export type ProjectLaunchSummary = {
  has_guide: boolean
  take_count: number
  ready_take_count: number
  arrangement_count: number
  has_mixdown: boolean
}

export type ProjectListItem = Project & {
  launch_summary: ProjectLaunchSummary
}
