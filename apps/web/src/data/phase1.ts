export const priorityCards = [
  {
    title: 'Note-level correction UI',
    items: [
      'Move beyond phrase-only summaries and surface the problem note directly in the studio.',
      'Show attack, sustain, timing, and confidence as separate correction cues.',
      'Keep the view readable enough that a singer can act on it without opening raw JSON.',
    ],
  },
  {
    title: 'Scoring mode transparency',
    items: [
      'Make `note-level` versus `fallback` scoring visible in the analysis panel.',
      'Show `chord-aware` versus `key-only` harmony mode without hiding current limits.',
      'Prevent fallback results from looking more precise than they really are.',
    ],
  },
  {
    title: 'Calibration gate',
    items: [
      'Back the new UI with real vocal fixtures instead of sine-only confidence.',
      'Tune thresholds so note score explanations match what good ears would say.',
      'Keep release claims aligned with the analysis mode that is actually implemented.',
    ],
  },
  {
    title: 'Phase 9 closeout',
    items: [
      'Finish the frontend leg of the intonation quality track without disturbing the core studio flow.',
      'Leave room for chord authoring and deeper calibration tooling in the next slice.',
      'Keep the MVP scorer honest while we move toward a more trustworthy judge.',
    ],
  },
] as const

export const currentLaneTickets = [
  'Phase 9',
  'Note-level correction UI',
  'Pitch mode transparency',
  'Harmony fallback cues',
  'Calibration gate next',
] as const
