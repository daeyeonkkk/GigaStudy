export const priorityCards = [
  {
    title: 'Failure visibility',
    items: [
      'Keep failed track state visible after upload or processing problems.',
      'Show the latest analysis failure reason instead of hiding it behind a generic error.',
      'Make retry paths obvious from both studio and admin views.',
    ],
  },
  {
    title: 'Retry workflows',
    items: [
      'Retry failed analysis jobs without recreating the whole project context.',
      'Retry track processing after the source audio or canonical artifact is fixed.',
      'Refresh operations state immediately after recovery actions.',
    ],
  },
  {
    title: 'Policies and traceability',
    items: [
      'Expose timeout and upload-expiry policy values in one place.',
      'Track which analysis, melody, and arrangement engine versions are active.',
      'Keep release-gate signals small enough to scan quickly.',
    ],
  },
  {
    title: 'Admin monitoring baseline',
    items: [
      'List recent failed tracks and recent analysis jobs together.',
      'Show project counts, ready-take counts, and failure counts at a glance.',
      'Leave room for a fuller dashboard without reworking the API shape.',
    ],
  },
] as const

export const currentLaneTickets = [
  'Phase 7',
  'Failure visibility',
  'Analysis retry',
  'Ops dashboard',
  'Timeout and expiry policy',
] as const
