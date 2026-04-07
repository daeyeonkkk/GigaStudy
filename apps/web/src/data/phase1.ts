export const priorityCards = [
  {
    title: 'Project history',
    items: [
      'Capture the current studio state as a lightweight snapshot before larger edits.',
      'Show guide, take, mixdown, and arrangement counts in the version history list.',
      'Keep the history readable enough to use as a real review trail.',
    ],
  },
  {
    title: 'Read-only sharing',
    items: [
      'Create share links from a frozen snapshot instead of a moving live project state.',
      'Keep the first share scope read-only so product promises stay conservative.',
      'Expose expiry and deactivation controls directly in the studio.',
    ],
  },
  {
    title: 'Shared review view',
    items: [
      'Render a public-facing review page that can play the frozen guide, takes, and mixdown.',
      'Leave editing controls out of the shared route.',
      'Keep export links available for arrangement review.',
    ],
  },
  {
    title: 'Phase 8 closeout',
    items: [
      'Finish the remaining P1 collaboration surface after arrangement polish.',
      'Keep the implementation small enough to stay inside the existing studio architecture.',
      'Leave room for fuller restore or permission controls in a later phase.',
    ],
  },
] as const

export const currentLaneTickets = [
  'Phase 8',
  'Project version history',
  'Read-only share links',
  'Shared review page',
  'P1 collaboration polish',
] as const
