import { getSixteenthNoteSeconds } from '../../lib/studio'

export function getGridSeconds(bpm: number): number {
  return getSixteenthNoteSeconds(bpm)
}
