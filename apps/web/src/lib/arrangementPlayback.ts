import { getArrangementDurationMs, type ArrangementPlaybackPart } from './arrangementParts'

export type ArrangementPlaybackMixerState = {
  enabled: boolean
  solo: boolean
  volume: number
}

type ArrangementPlaybackOptions = {
  parts: ArrangementPlaybackPart[]
  mixerState: Record<string, ArrangementPlaybackMixerState>
  guideModeEnabled: boolean
  guideFocusPartName: string | null
  onPositionChange?: (positionMs: number) => void
  onEnded?: () => void
}

type ArrangementPlaybackNode = {
  oscillator: OscillatorNode
  gain: GainNode
}

export type ArrangementPlaybackController = {
  durationMs: number
  stop: (resetPosition?: boolean) => Promise<void>
}

function midiToFrequency(pitchMidi: number): number {
  return 440 * Math.pow(2, (pitchMidi - 69) / 12)
}

function clampVolume(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function resolvePartGain(
  part: ArrangementPlaybackPart,
  mixerState: Record<string, ArrangementPlaybackMixerState>,
  guideModeEnabled: boolean,
  guideFocusPartName: string | null,
  anySolo: boolean,
): number {
  const partMixer = mixerState[part.part_name]
  const enabled = partMixer?.enabled ?? true
  const volume = clampVolume(partMixer?.volume ?? 0.8)
  const normalizedRole = part.role.toUpperCase()

  if (!enabled) {
    return 0
  }

  if (anySolo && !(partMixer?.solo ?? false)) {
    return 0
  }

  if (!guideModeEnabled) {
    return volume
  }

  if (guideFocusPartName) {
    return part.part_name === guideFocusPartName ? volume : volume * 0.24
  }

  if (normalizedRole === 'MELODY') {
    return volume
  }

  return volume * 0.3
}

export async function startArrangementPlayback(
  options: ArrangementPlaybackOptions,
): Promise<ArrangementPlaybackController> {
  const AudioContextCtor =
    window.AudioContext ??
    (
      window as Window &
        typeof globalThis & {
          webkitAudioContext?: typeof AudioContext
        }
    ).webkitAudioContext
  if (typeof AudioContextCtor === 'undefined') {
    throw new Error('Web Audio is not available in this browser.')
  }

  const anySolo = Object.values(options.mixerState).some((entry) => entry.solo)
  const durationMs = getArrangementDurationMs(options.parts)
  if (durationMs <= 0) {
    throw new Error('This arrangement does not contain playable notes yet.')
  }

  const audioContext = new AudioContextCtor()
  await audioContext.resume()

  const masterGain = audioContext.createGain()
  masterGain.gain.value = 0.92
  masterGain.connect(audioContext.destination)

  const startTime = audioContext.currentTime + 0.04
  const activeNodes: ArrangementPlaybackNode[] = []
  let rafId = 0
  let finished = false

  const updatePosition = (): void => {
    if (finished) {
      return
    }

    const elapsedMs = Math.max(0, (audioContext.currentTime - startTime) * 1000)
    options.onPositionChange?.(Math.min(durationMs, elapsedMs))

    if (elapsedMs >= durationMs) {
      finished = true
      options.onPositionChange?.(durationMs)
      options.onEnded?.()
      return
    }

    rafId = window.requestAnimationFrame(updatePosition)
  }

  for (const part of options.parts) {
    const partGainValue = resolvePartGain(
      part,
      options.mixerState,
      options.guideModeEnabled,
      options.guideFocusPartName,
      anySolo,
    )
    if (partGainValue <= 0) {
      continue
    }

    const normalizedRole = part.role.toUpperCase()

    for (const note of part.notes) {
      const noteStart = startTime + note.start_ms / 1000
      const noteEnd = startTime + Math.max(note.start_ms + 30, note.end_ms) / 1000
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()

      oscillator.type =
        normalizedRole === 'BASS'
          ? 'triangle'
          : normalizedRole === 'PERCUSSION'
            ? 'square'
            : 'sine'
      oscillator.frequency.setValueAtTime(
        normalizedRole === 'PERCUSSION'
          ? note.pitch_midi < 37
            ? 84
            : 176
          : midiToFrequency(note.pitch_midi),
        noteStart,
      )

      const noteVelocity = clampVolume((note.velocity || 84) / 127)
      const noteGain = partGainValue * noteVelocity * (normalizedRole === 'PERCUSSION' ? 0.72 : 0.46)
      gainNode.gain.setValueAtTime(0.0001, noteStart)
      gainNode.gain.linearRampToValueAtTime(noteGain, noteStart + 0.01)

      if (normalizedRole === 'PERCUSSION') {
        gainNode.gain.exponentialRampToValueAtTime(0.0001, Math.min(noteEnd, noteStart + 0.15))
      } else {
        gainNode.gain.setValueAtTime(noteGain, Math.max(noteStart + 0.02, noteEnd - 0.03))
        gainNode.gain.linearRampToValueAtTime(0.0001, noteEnd)
      }

      oscillator.connect(gainNode)
      gainNode.connect(masterGain)
      oscillator.start(noteStart)
      oscillator.stop(noteEnd + 0.04)
      activeNodes.push({ oscillator, gain: gainNode })
    }
  }

  if (activeNodes.length === 0) {
    await audioContext.close().catch(() => undefined)
    throw new Error('No arrangement parts are active. Turn on a part or clear solo mode first.')
  }

  rafId = window.requestAnimationFrame(updatePosition)

  const stop = async (resetPosition = true): Promise<void> => {
    if (finished) {
      if (resetPosition) {
        options.onPositionChange?.(0)
      }
      return
    }

    finished = true
    window.cancelAnimationFrame(rafId)
    for (const node of activeNodes) {
      try {
        node.oscillator.stop()
      } catch {
        // Ignore nodes that have already stopped.
      }
      node.oscillator.disconnect()
      node.gain.disconnect()
    }

    await audioContext.close().catch(() => undefined)
    if (resetPosition) {
      options.onPositionChange?.(0)
    }
  }

  window.setTimeout(() => {
    if (!finished) {
      finished = true
      window.cancelAnimationFrame(rafId)
      options.onPositionChange?.(durationMs)
      options.onEnded?.()
      void audioContext.close().catch(() => undefined)
    }
  }, durationMs + 120)

  return {
    durationMs,
    stop,
  }
}
