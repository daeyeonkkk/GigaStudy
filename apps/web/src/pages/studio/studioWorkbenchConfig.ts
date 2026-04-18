export const studioWorkbenchLinks = [
  { id: 'harmony-authoring', label: '코드' },
  { id: 'audio-setup', label: '장치' },
  { id: 'recording', label: '녹음' },
  { id: 'analysis', label: '분석' },
  { id: 'melody', label: '멜로디' },
  { id: 'arrangement', label: '편곡' },
  { id: 'score-playback', label: '악보 / 재생' },
  { id: 'mixdown', label: '믹스다운' },
  { id: 'version', label: '버전' },
  { id: 'sharing', label: '공유' },
] as const

export type StudioSectionId = (typeof studioWorkbenchLinks)[number]['id']

export type StudioWorkspaceModeId = 'record' | 'review' | 'arrange'

export type StudioWorkspaceMode = {
  id: StudioWorkspaceModeId
  label: string
  sectionIds: StudioSectionId[]
}

export const studioRailLabels: Record<StudioSectionId, string> = {
  'harmony-authoring': '코드',
  'audio-setup': '장치',
  recording: '녹음',
  analysis: '분석',
  melody: '멜로디',
  arrangement: '편곡',
  'score-playback': '악보 / 재생',
  mixdown: '믹스다운',
  version: '버전',
  sharing: '공유',
}

export const studioSectionModeMap: Record<StudioSectionId, StudioWorkspaceModeId> = {
  'harmony-authoring': 'review',
  'audio-setup': 'record',
  recording: 'record',
  analysis: 'review',
  melody: 'arrange',
  arrangement: 'arrange',
  'score-playback': 'arrange',
  mixdown: 'arrange',
  version: 'arrange',
  sharing: 'arrange',
}

export const studioDefaultSectionByMode: Record<StudioWorkspaceModeId, StudioSectionId> = {
  record: 'recording',
  review: 'analysis',
  arrange: 'arrangement',
}

export const studioWorkspaceModes: ReadonlyArray<StudioWorkspaceMode> = [
  {
    id: 'record',
    label: '녹음',
    sectionIds: ['audio-setup', 'recording'],
  },
  {
    id: 'review',
    label: '리뷰',
    sectionIds: ['harmony-authoring', 'analysis'],
  },
  {
    id: 'arrange',
    label: '편곡 준비',
    sectionIds: ['melody', 'arrangement', 'score-playback', 'mixdown', 'version', 'sharing'],
  },
]

export function getStudioWorkspaceMode(modeId: StudioWorkspaceModeId): StudioWorkspaceMode {
  return studioWorkspaceModes.find((mode) => mode.id === modeId) ?? studioWorkspaceModes[0]
}
