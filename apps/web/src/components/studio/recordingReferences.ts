import type { TrackSlot } from '../../types/studio'

export type RecordingReferenceSetup = {
  includeMetronome: boolean
  selectedReferenceSlotIds: number[]
  targetSlotId: number
}

export function isRecordingReferenceTrackAvailable(track: TrackSlot): boolean {
  return track.status === 'registered'
}

export function getDefaultRecordingReferenceSlotIds(
  tracks: TrackSlot[],
  targetSlotId: number,
): number[] {
  return tracks
    .filter((track) => track.slot_id !== targetSlotId && isRecordingReferenceTrackAvailable(track))
    .map((track) => track.slot_id)
}

export function toggleRecordingReferenceSlot(
  selectedReferenceSlotIds: number[],
  slotId: number,
): number[] {
  return selectedReferenceSlotIds.includes(slotId)
    ? selectedReferenceSlotIds.filter((selectedSlotId) => selectedSlotId !== slotId)
    : [...selectedReferenceSlotIds, slotId].sort((left, right) => left - right)
}

export function getRecordingGuideLabel(referenceTrackCount: number, includeMetronome: boolean): string {
  if (referenceTrackCount > 0 && includeMetronome) {
    return '기준 재생 · 메트로놈'
  }
  if (referenceTrackCount > 0) {
    return '기준 재생 중'
  }
  if (includeMetronome) {
    return '메트로놈만'
  }
  return '무음 카운트'
}
