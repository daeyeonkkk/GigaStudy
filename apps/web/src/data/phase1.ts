export const priorityCards = [
  {
    title: 'Chord timeline authoring',
    items: [
      'Make chord-aware harmony reachable from the main studio instead of relying on preloaded project metadata.',
      'Support both lightweight row editing and JSON paste for prepared markers.',
      'Keep the first pass small enough to avoid turning the studio into a full chart editor.',
    ],
  },
  {
    title: 'Harmony mode reachability',
    items: [
      'Let users save markers, rerun analysis, and actually see `CHORD_AWARE` without leaving the workflow.',
      'Keep `KEY_ONLY` fallback visible whenever no saved chord timeline exists.',
      'Make the transition from fallback to chord-aware analysis understandable in the UI.',
    ],
  },
  {
    title: 'Calibration gate',
    items: [
      'Build on the new synthetic-vocal checkpoint with real singer recordings or a cents-shifted corpus.',
      'Tune thresholds so note score explanations match what good ears would say.',
      'Keep release claims aligned with the analysis mode that is actually implemented.',
    ],
  },
  {
    title: 'Phase 9 closeout',
    items: [
      'Finish the reachability leg of the intonation quality track without disturbing the core studio flow.',
      'Leave room for deeper chord import and calibration tooling in the next slice.',
      'Keep the MVP scorer honest while we move toward a more trustworthy judge.',
    ],
  },
] as const

export const currentLaneTickets = [
  'Phase 9',
  'Chord timeline authoring',
  'Chord-aware reachability',
  'Harmony fallback cues',
  'Human-rating calibration next',
] as const
