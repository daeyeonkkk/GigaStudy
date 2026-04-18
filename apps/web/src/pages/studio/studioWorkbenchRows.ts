type MixerTrackStateLike = {
  muted: boolean
  solo: boolean
  volume: number
}

type ScoreLike = {
  total_score: number | null
}

type TakeTrackLike = {
  duration_ms: number | null
  latest_score: ScoreLike | null
  part_type: string | null
  recording_finished_at: string | null
  source_artifact_url: string | null
  take_no: number | null
  track_id: string
  track_status: string
}

type GuideTrackLike = {
  track_id: string
  track_status: string
}

type ArrangementPartLike = {
  notes: unknown[]
  part_name: string
  role: string
}

type ArrangementPlaybackMixerStateLike = {
  enabled: boolean
  solo: boolean
  volume: number
}

type MelodyNoteLike = {
  duration_ms: number
  end_ms: number
  phrase_index: number
  pitch_midi: number
  pitch_name: string
  start_ms: number
}

export type StudioRailTakeItem = {
  active: boolean
  id: string
  label: string
  meta: string
  onSelect: () => void
}

export type StudioRecordingTakeItem = {
  durationLabel: string
  failedUpload: boolean
  finishedAtLabel: string
  id: string
  label: string
  muted: boolean
  onRetryUpload: () => void
  onSelect: () => void
  previewUrl: string | null
  progress: number | null
  retryUploadDisabled: boolean
  retryUploadLabel: string
  selected: boolean
  subhead: string
  volume: number
}

export type StudioTimelinePlayer = {
  label: string
  muted: boolean
  src: string
  volume: number
}

export type StudioTimelineTrackRow = {
  id: string
  label: string
  meta: string
  muted: boolean
  onPrimaryAction: () => void
  onToggleMute: () => void
  onToggleSolo: () => void
  onVolumeChange: (value: number) => void
  primaryActionLabel: string
  progress: number | null
  selected: boolean
  solo: boolean
  volume: number
}

export type StudioPlaybackPartRow = {
  color: string
  enabled: boolean
  guideFocus: boolean
  id: string
  noteCountLabel: string
  onGuideFocusToggle: () => void
  onSoloToggle: () => void
  onToggleEnabled: (enabled: boolean) => void
  onVolumeChange: (value: number) => void
  partName: string
  role: string
  solo: boolean
  volume: number
}

export type StudioMelodyEditorRow = {
  durationLabel: string
  endMs: number
  id: string
  onEndMsChange: (value: number) => void
  onPhraseIndexChange: (value: number) => void
  onPitchMidiChange: (value: number) => void
  onRemove: () => void
  onStartMsChange: (value: number) => void
  phraseIndex: number
  pitchMidi: number
  pitchName: string
  startMs: number
}

export function buildRailTakeItems({
  formatCompactPercent,
  getTrackStatusLabel,
  onSelectTake,
  takes,
  selectedTakeId,
}: {
  formatCompactPercent: (value: number | null | undefined) => string
  getTrackStatusLabel: (status: string) => string
  onSelectTake: (trackId: string) => void
  selectedTakeId: string | null
  takes: TakeTrackLike[]
}): StudioRailTakeItem[] {
  return takes.slice(0, 6).map((take) => ({
    active: selectedTakeId === take.track_id,
    id: take.track_id,
    label: `${take.take_no ?? '?'}번`,
    meta: `${getTrackStatusLabel(take.track_status)}${
      take.latest_score ? ` / ${formatCompactPercent(take.latest_score.total_score)}` : ''
    }`,
    onSelect: () => onSelectTake(take.track_id),
  }))
}

export function buildRecordingTakeItems<Take extends TakeTrackLike>({
  activeUploadTrackId,
  failedTakeUploads,
  formatDate,
  formatDuration,
  getPartTypeLabel,
  getTrackStatusLabel,
  isTrackMutedByMixer,
  mixerState,
  normalizeAssetUrl,
  onRetryUpload,
  onSelectTake,
  selectedTakeId,
  takePreviewUrls,
  takeUploadProgress,
  takes,
}: {
  activeUploadTrackId: string | null
  failedTakeUploads: Record<string, unknown>
  formatDate: (value: string) => string
  formatDuration: (value: number | null | undefined) => string
  getPartTypeLabel: (partType: string) => string
  getTrackStatusLabel: (status: string) => string
  isTrackMutedByMixer: (trackId: string) => boolean
  mixerState: Record<string, MixerTrackStateLike>
  normalizeAssetUrl: (value: string | null | undefined) => string | null
  onRetryUpload: (take: Take) => void
  onSelectTake: (trackId: string) => void
  selectedTakeId: string | null
  takePreviewUrls: Record<string, string>
  takeUploadProgress: Record<string, number>
  takes: Take[]
}): StudioRecordingTakeItem[] {
  return takes.map((take) => {
    const failedUpload = failedTakeUploads[take.track_id]
    const progress = takeUploadProgress[take.track_id]
    const previewUrl = takePreviewUrls[take.track_id] ?? normalizeAssetUrl(take.source_artifact_url) ?? null

    return {
      durationLabel: formatDuration(take.duration_ms),
      failedUpload: Boolean(failedUpload),
      finishedAtLabel: take.recording_finished_at ? formatDate(take.recording_finished_at) : '기록 없음',
      id: take.track_id,
      label: `${take.take_no ?? '?'}번 테이크`,
      muted: isTrackMutedByMixer(take.track_id),
      onRetryUpload: () => onRetryUpload(take),
      onSelect: () => onSelectTake(take.track_id),
      previewUrl,
      progress: typeof progress === 'number' ? progress : null,
      retryUploadDisabled: activeUploadTrackId === take.track_id,
      retryUploadLabel: activeUploadTrackId === take.track_id ? '재시도 중..' : '업로드 재시도',
      selected: selectedTakeId === take.track_id,
      subhead: `${getPartTypeLabel(take.part_type ?? 'LEAD')} | ${getTrackStatusLabel(take.track_status)}`,
      volume: mixerState[take.track_id]?.volume ?? 1,
    }
  })
}

export function buildTimelinePlayers({
  guide,
  guideSourceUrl,
  guideVolume,
  isGuideMuted,
  isSelectedTakeMuted,
  selectedTake,
  selectedTakePlaybackUrl,
  selectedTakeVolume,
}: {
  guide: GuideTrackLike | null
  guideSourceUrl: string | null
  guideVolume: number
  isGuideMuted: boolean
  isSelectedTakeMuted: boolean
  selectedTake: TakeTrackLike | null
  selectedTakePlaybackUrl: string | null
  selectedTakeVolume: number
}): StudioTimelinePlayer[] {
  return [
    guideSourceUrl && guide
      ? {
          label: '가이드 듣기',
          muted: isGuideMuted,
          src: guideSourceUrl,
          volume: guideVolume,
        }
      : null,
    selectedTakePlaybackUrl && selectedTake
      ? {
          label: '선택 테이크 듣기',
          muted: isSelectedTakeMuted,
          src: selectedTakePlaybackUrl,
          volume: selectedTakeVolume,
        }
      : null,
  ].filter((item): item is StudioTimelinePlayer => item !== null)
}

export function buildTimelineGuideRow({
  getTrackStatusLabel,
  guide,
  guideMuted,
  guideSolo,
  guideVolume,
  onToggleMute,
  onToggleSolo,
  onVolumeChange,
}: {
  getTrackStatusLabel: (status: string) => string
  guide: GuideTrackLike | null
  guideMuted: boolean
  guideSolo: boolean
  guideVolume: number
  onToggleMute: () => void
  onToggleSolo: () => void
  onVolumeChange: (value: number) => void
}): StudioTimelineTrackRow | null {
  if (!guide) {
    return null
  }

  return {
    id: guide.track_id,
    label: '가이드',
    meta: getTrackStatusLabel(guide.track_status),
    muted: guideMuted,
    onPrimaryAction: () => undefined,
    onToggleMute,
    onToggleSolo,
    onVolumeChange,
    primaryActionLabel: '가이드',
    progress: null,
    selected: false,
    solo: guideSolo,
    volume: guideVolume,
  }
}

export function buildTimelineRows({
  formatPercent,
  getTrackStatusLabel,
  mixerState,
  onSelectTake,
  onToggleMute,
  onToggleSolo,
  onVolumeChange,
  selectedTakeId,
  takeUploadProgress,
  takes,
}: {
  formatPercent: (value: number | null) => string
  getTrackStatusLabel: (status: string) => string
  mixerState: Record<string, MixerTrackStateLike>
  onSelectTake: (trackId: string) => void
  onToggleMute: (trackId: string) => void
  onToggleSolo: (trackId: string) => void
  onVolumeChange: (trackId: string, value: number) => void
  selectedTakeId: string | null
  takeUploadProgress: Record<string, number>
  takes: TakeTrackLike[]
}): StudioTimelineTrackRow[] {
  return takes.map((take) => ({
    id: take.track_id,
    label: `${take.take_no ?? '?'}번 테이크`,
    meta: `${getTrackStatusLabel(take.track_status)}${
      take.latest_score ? ` · ${formatPercent(take.latest_score.total_score)}` : ''
    }`,
    muted: mixerState[take.track_id]?.muted ?? false,
    onPrimaryAction: () => onSelectTake(take.track_id),
    onToggleMute: () => onToggleMute(take.track_id),
    onToggleSolo: () => onToggleSolo(take.track_id),
    onVolumeChange: (value: number) => onVolumeChange(take.track_id, value),
    primaryActionLabel: selectedTakeId === take.track_id ? '선택됨' : '이 테이크 보기',
    progress: takeUploadProgress[take.track_id] ?? null,
    selected: selectedTakeId === take.track_id,
    solo: mixerState[take.track_id]?.solo ?? false,
    volume: mixerState[take.track_id]?.volume ?? 1,
  }))
}

export function buildPlaybackPartRows({
  arrangementPartMixerState,
  getArrangementPartColor,
  getDefaultArrangementPartVolume,
  guideFocusPartName,
  onGuideFocusToggle,
  onToggleEnabled,
  onToggleSolo,
  onVolumeChange,
  parts,
}: {
  arrangementPartMixerState: Record<string, ArrangementPlaybackMixerStateLike>
  getArrangementPartColor: (role: string, index: number) => string
  getDefaultArrangementPartVolume: (role: string) => number
  guideFocusPartName: string | null
  onGuideFocusToggle: (partName: string) => void
  onToggleEnabled: (partName: string, enabled: boolean) => void
  onToggleSolo: (partName: string, nextSolo: boolean) => void
  onVolumeChange: (partName: string, value: number) => void
  parts: ArrangementPartLike[]
}): StudioPlaybackPartRow[] {
  return parts.map((part, index) => {
    const partMixer = arrangementPartMixerState[part.part_name] ?? {
      enabled: true,
      solo: false,
      volume: getDefaultArrangementPartVolume(part.role),
    }

    return {
      color: getArrangementPartColor(part.role, index),
      enabled: partMixer.enabled,
      guideFocus: guideFocusPartName === part.part_name,
      id: part.part_name,
      noteCountLabel: `${part.notes.length}개`,
      onGuideFocusToggle: () => onGuideFocusToggle(part.part_name),
      onSoloToggle: () => onToggleSolo(part.part_name, !partMixer.solo),
      onToggleEnabled: (enabled: boolean) => onToggleEnabled(part.part_name, enabled),
      onVolumeChange: (value: number) => onVolumeChange(part.part_name, value),
      partName: part.part_name,
      role: part.role,
      solo: partMixer.solo,
      volume: partMixer.volume,
    }
  })
}

export function buildMelodyEditorRows({
  notes,
  onRemoveNote,
  onUpdateNote,
}: {
  notes: MelodyNoteLike[]
  onRemoveNote: (index: number) => void
  onUpdateNote: (
    index: number,
    key: 'end_ms' | 'phrase_index' | 'pitch_midi' | 'start_ms',
    value: number,
  ) => void
}): StudioMelodyEditorRow[] {
  return notes.map((note, index) => ({
    durationLabel: `${note.duration_ms}ms`,
    endMs: note.end_ms,
    id: `melody-note-${index}`,
    onEndMsChange: (value: number) => onUpdateNote(index, 'end_ms', value),
    onPhraseIndexChange: (value: number) => onUpdateNote(index, 'phrase_index', value),
    onPitchMidiChange: (value: number) => onUpdateNote(index, 'pitch_midi', value),
    onRemove: () => onRemoveNote(index),
    onStartMsChange: (value: number) => onUpdateNote(index, 'start_ms', value),
    phraseIndex: note.phrase_index,
    pitchMidi: note.pitch_midi,
    pitchName: note.pitch_name,
    startMs: note.start_ms,
  }))
}
