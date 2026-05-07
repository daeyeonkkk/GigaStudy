export type StudioActionState =
  | { phase: 'idle' }
  | {
      phase: 'busy'
      message: string
      detail?: string
      startedAtMs?: number
      elapsedSeconds?: number
      estimatedSecondsRemaining?: number
      progressPercent?: number
      source?: string
    }
  | {
      phase: 'success' | 'warning' | 'error'
      message: string
      detail?: string
      source?: string
    }

export type SetStudioActionState = (state: StudioActionState) => void

export type RunStudioAction = (
  action: () => Promise<import('../../types/studio').Studio>,
  busyMessage: string,
  successMessage: string,
  progressMessages?: string[],
) => Promise<boolean>
