export const priorityCards = [
  {
    title: 'Environment diagnostics',
    items: [
      'Turn saved DeviceProfiles into an ops-visible browser and hardware diagnostics baseline.',
      'Keep warning flags, permissions, codec support, and audio-context mode visible by environment.',
      'Make real hardware validation easier instead of leaving support to guesswork.',
    ],
  },
  {
    title: 'Native browser validation',
    items: [
      'Use Chromium, Firefox, and WebKit automation as the seeded baseline, not the final proof.',
      'Add native Safari and real-hardware checks on top of the new diagnostics report and manual validation log.',
      'Keep unsupported paths explicit in release notes and ops summaries.',
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
    title: 'Next closeout',
    items: [
      'Finish the environment-validation leg without disturbing the seeded release gate.',
      'Leave room for deeper native Safari and long-session hardware runs in the next slice.',
      'Keep the MVP scorer and browser-support claims honest while coverage deepens.',
    ],
  },
] as const

export const currentLaneTickets = [
  'Environment validation',
  'Ops diagnostics export',
  'Validation run logging',
  'Native Safari checklist',
  'Hardware variability tracking',
  'Human-rating calibration next',
] as const
