export function clampTrackVolumePercent(value: number, fallback = 100): number {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function parseTrackVolumeDraft(rawValue: string): number | null {
  const parsed = Number.parseFloat(rawValue)
  return Number.isFinite(parsed) ? clampTrackVolumePercent(parsed) : null
}

export function shouldSaveTrackVolumeDraft(nextVolumePercent: number, lastCommittedVolumePercent: number): boolean {
  return clampTrackVolumePercent(nextVolumePercent) !== clampTrackVolumePercent(lastCommittedVolumePercent)
}
