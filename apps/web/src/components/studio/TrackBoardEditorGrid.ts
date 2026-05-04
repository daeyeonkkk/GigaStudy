export function getGridSeconds(bpm: number): number {
  return (60 / Math.max(1, bpm)) / 2
}
