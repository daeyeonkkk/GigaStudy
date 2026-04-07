export type ArrangementPlaybackNote = {
  pitch_midi: number
  start_ms: number
  end_ms: number
  velocity: number
}

export type ArrangementPlaybackPart = {
  part_name: string
  role: string
  notes: ArrangementPlaybackNote[]
}

const roleColors: Record<string, string> = {
  MELODY: '#2b6cb0',
  BASS: '#1f2937',
  PERCUSSION: '#7c3aed',
}

const fallbackPalette = ['#2b6cb0', '#d97706', '#15803d', '#be123c', '#6d28d9', '#475569']

export function getArrangementPartColor(role: string, index: number): string {
  const normalizedRole = role.toUpperCase()
  return roleColors[normalizedRole] ?? fallbackPalette[index % fallbackPalette.length]
}

export function getArrangementDurationMs(parts: ArrangementPlaybackPart[]): number {
  let maxDuration = 0

  for (const part of parts) {
    for (const note of part.notes) {
      maxDuration = Math.max(maxDuration, note.end_ms)
    }
  }

  return maxDuration
}

export function getDefaultArrangementPartVolume(role: string): number {
  const normalizedRole = role.toUpperCase()
  if (normalizedRole === 'MELODY') {
    return 0.96
  }
  if (normalizedRole === 'BASS') {
    return 0.82
  }
  if (normalizedRole === 'PERCUSSION') {
    return 0.56
  }
  return 0.78
}
