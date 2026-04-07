export const priorityCards = [
  {
    title: 'Difficulty presets',
    items: [
      'Keep beginner, basic, and strict presets attached to the arrangement generator.',
      'Explain what each preset changes before the user generates a candidate batch.',
      'Use the selected preset when comparing A/B/C instead of hiding it in JSON.',
    ],
  },
  {
    title: 'Voice range presets',
    items: [
      'Offer S, A, T, B, and Baritone lead presets directly in the studio.',
      'Push the selected preset into the rule-based arrangement engine.',
      'Show whether each candidate still fits the chosen lead range well.',
    ],
  },
  {
    title: 'Candidate comparison',
    items: [
      'Surface lead-fit, max leap, and parallel-motion warnings on the compare cards.',
      'Make candidate A/B/C feel like a real choice, not three opaque JSON blobs.',
      'Keep the editable arrangement JSON available after the compare pass.',
    ],
  },
  {
    title: 'Beatbox templates',
    items: [
      'Expand from a single on/off percussion toggle to multiple beatbox templates.',
      'Keep template selection lightweight and rule-based for P1.',
      'Carry the chosen template through comparison, playback, and export.',
    ],
  },
] as const

export const currentLaneTickets = [
  'Phase 8',
  'Difficulty presets',
  'Voice range presets',
  'Candidate compare UI',
  'Beatbox templates',
] as const
