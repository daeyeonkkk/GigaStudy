export const priorityCards = [
  {
    title: 'Project and guide connection',
    items: [
      'Create a project with stable musical metadata.',
      'Connect one guide track to the project and keep it reloadable.',
      'Keep the studio entry flow fast enough for repeated retries.',
    ],
  },
  {
    title: 'Device settings and DeviceProfile',
    items: [
      'Request mic permission and list input devices.',
      'Show requested constraints beside the real getSettings() result.',
      'Save one reusable profile keyed by browser, OS, input device, and output route.',
    ],
  },
  {
    title: 'Take recording and upload',
    items: [
      'Prepare the studio for repeated take capture.',
      'Keep upload status visible after each recording attempt.',
      'Make guide and take status easy to scan from one screen.',
    ],
  },
  {
    title: 'Processing readiness',
    items: [
      'Preserve enough metadata for later worker jobs.',
      'Keep source, canonical, peaks, and mixdown artifacts linkable.',
      'Leave room for alignment and scoring without reworking the schema.',
    ],
  },
] as const

export const currentLaneTickets = [
  'Phase 3',
  'Audio to MIDI',
  'Quantize',
  'Key estimate',
  'Editable melody draft',
] as const
