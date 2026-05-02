export type StudioActionState =
  | { phase: 'idle' }
  | { phase: 'busy'; message: string }
  | { phase: 'success'; message: string }
  | { phase: 'error'; message: string }

export type SetStudioActionState = (state: StudioActionState) => void

export type RunStudioAction = (
  action: () => Promise<import('../../types/studio').Studio>,
  busyMessage: string,
  successMessage: string,
  progressMessages?: string[],
) => Promise<boolean>
