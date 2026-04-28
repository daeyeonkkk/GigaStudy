import { getBrowserAudioContextConstructor } from '../audio/audioContext'
import {
  DEFAULT_METER,
  getBeatSeconds,
  isMeasureDownbeat,
  type MeterContext,
} from './timing'

export type PlaybackNode = {
  filters?: BiquadFilterNode[]
  media?: HTMLAudioElement
  oscillator?: OscillatorNode
  oscillators?: OscillatorNode[]
  source?: AudioBufferSourceNode
  gain?: GainNode
  gains?: GainNode[]
}

export type PlaybackSourceMode = 'audio' | 'score'

export type PlaybackSession = {
  context?: AudioContext
  nodes: PlaybackNode[]
  timeoutIds: number[]
}

export function createTone(
  context: AudioContext,
  startTime: number,
  duration: number,
  frequency: number,
  volume: number,
  type: OscillatorType | 'piano',
): PlaybackNode {
  if (type === 'piano') {
    return createPianoTone(context, startTime, duration, frequency, volume)
  }

  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const attackTime = Math.min(0.025, duration / 3)

  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, startTime)
  gain.gain.setValueAtTime(0.0001, startTime)
  gain.gain.linearRampToValueAtTime(volume, startTime + attackTime)
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(startTime)
  oscillator.stop(startTime + duration + 0.03)

  return { oscillator, gain }
}

function createPianoTone(
  context: AudioContext,
  startTime: number,
  duration: number,
  frequency: number,
  volume: number,
): PlaybackNode {
  const filter = context.createBiquadFilter()
  const masterGain = context.createGain()
  const attackTime = Math.min(0.012, duration / 4)
  const decayTime = Math.min(duration * 0.42, 0.18)
  const sustainLevel = Math.max(0.0001, volume * 0.12)
  const releaseTime = Math.max(0.04, Math.min(0.12, duration * 0.22))
  const oscillators: OscillatorNode[] = []
  const gains: GainNode[] = [masterGain]

  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(Math.min(4200, Math.max(1200, frequency * 7.8)), startTime)
  filter.Q.setValueAtTime(0.8, startTime)

  masterGain.gain.setValueAtTime(0.0001, startTime)
  masterGain.gain.linearRampToValueAtTime(volume, startTime + attackTime)
  masterGain.gain.exponentialRampToValueAtTime(
    Math.max(0.0001, sustainLevel),
    startTime + attackTime + decayTime,
  )
  masterGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration + releaseTime)

  filter.connect(masterGain)
  masterGain.connect(context.destination)

  const partials: Array<{ ratio: number; type: OscillatorType; gain: number; releaseScale: number }> = [
    { ratio: 1, type: 'triangle', gain: 0.9, releaseScale: 1 },
    { ratio: 2, type: 'sine', gain: 0.22, releaseScale: 0.68 },
    { ratio: 3, type: 'sine', gain: 0.08, releaseScale: 0.52 },
  ]

  partials.forEach((partial, index) => {
    const oscillator = context.createOscillator()
    const partialGain = context.createGain()
    oscillator.type = partial.type
    oscillator.frequency.setValueAtTime(frequency * partial.ratio, startTime)
    partialGain.gain.setValueAtTime(0.0001, startTime)
    partialGain.gain.linearRampToValueAtTime(volume * partial.gain, startTime + attackTime)
    partialGain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, volume * partial.gain * 0.12),
      startTime + attackTime + decayTime * partial.releaseScale,
    )
    partialGain.gain.exponentialRampToValueAtTime(
      0.0001,
      startTime + duration + releaseTime * (index === 0 ? 1 : partial.releaseScale),
    )
    oscillator.connect(partialGain)
    partialGain.connect(filter)
    oscillator.start(startTime)
    oscillator.stop(startTime + duration + releaseTime + 0.03)
    oscillators.push(oscillator)
    gains.push(partialGain)
  })

  return {
    filters: [filter],
    gain: masterGain,
    gains,
    oscillators,
  }
}

export function createAudioBufferPlayback(
  context: AudioContext,
  buffer: AudioBuffer,
  startTime: number,
  offsetSeconds: number,
  volume: number,
): PlaybackNode | null {
  if (offsetSeconds >= buffer.duration) {
    return null
  }

  const source = context.createBufferSource()
  const gain = context.createGain()
  const safeOffsetSeconds = Math.max(0, offsetSeconds)
  const duration = Math.max(0, buffer.duration - safeOffsetSeconds)

  source.buffer = buffer
  gain.gain.setValueAtTime(volume, startTime)

  source.connect(gain)
  gain.connect(context.destination)
  source.start(startTime, safeOffsetSeconds, duration)
  source.stop(startTime + duration + 0.03)

  return { source, gain }
}

export function createMediaElementPlayback(audioUrl: string, volume: number): PlaybackNode {
  const media = new Audio(audioUrl)
  media.preload = 'auto'
  media.volume = Math.max(0, Math.min(1, volume))
  return { media }
}

export function prepareMediaElementPlayback(
  node: PlaybackNode,
  timeoutMilliseconds = 3500,
): Promise<void> {
  if (!node.media) {
    return Promise.resolve()
  }

  const media = node.media
  const hasPlayableBuffer = () => media.readyState >= 3
  if (hasPlayableBuffer()) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    let settled = false
    let timeoutId: number | null = null

    const cleanup = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
      media.removeEventListener('canplay', handleReady)
      media.removeEventListener('canplaythrough', handleReady)
      media.removeEventListener('loadeddata', handleLoadedData)
      media.removeEventListener('progress', handleLoadedData)
      media.removeEventListener('error', handleError)
    }

    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve()
    }

    const fail = (error: unknown) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    }

    const handleReady = () => finish()
    const handleLoadedData = () => {
      if (hasPlayableBuffer()) {
        finish()
      }
    }
    const handleError = () => fail(new Error('Track audio media could not be loaded.'))

    media.addEventListener('canplay', handleReady)
    media.addEventListener('canplaythrough', handleReady)
    media.addEventListener('loadeddata', handleLoadedData)
    media.addEventListener('progress', handleLoadedData)
    media.addEventListener('error', handleError)

    timeoutId = window.setTimeout(() => {
      if (hasPlayableBuffer()) {
        finish()
        return
      }
      fail(new Error('Track audio media was not ready before playback timeout.'))
    }, timeoutMilliseconds)

    try {
      media.load()
    } catch (error) {
      fail(error)
    }

    if (hasPlayableBuffer()) {
      finish()
    }
  })
}

export function scheduleMediaElementPlayback(
  node: PlaybackNode,
  delaySeconds: number,
  offsetSeconds: number,
  onError?: (error: unknown) => void,
): number | null {
  if (!node.media) {
    return null
  }

  const media = node.media
  const start = () => {
    try {
      media.currentTime = Math.max(0, offsetSeconds)
      void media.play().catch((error) => {
        onError?.(error)
      })
    } catch (error) {
      onError?.(error)
    }
  }

  if (delaySeconds <= 0.02) {
    start()
    return null
  }

  return window.setTimeout(start, Math.round(delaySeconds * 1000))
}

export function startLoopingMetronomeSession(
  bpm: number,
  meter: MeterContext = DEFAULT_METER,
): PlaybackSession | null {
  const AudioContextConstructor = getBrowserAudioContextConstructor()
  if (!AudioContextConstructor) {
    return null
  }

  let context: AudioContext
  try {
    context = new AudioContextConstructor()
  } catch {
    return null
  }

  const beatSeconds = getBeatSeconds(bpm)
  const pulseSeconds = Math.max(0.04, beatSeconds * meter.pulseQuarterBeats)
  const lookaheadMilliseconds = 25
  const scheduleAheadSeconds = 0.12
  const session: PlaybackSession = { context, nodes: [], timeoutIds: [] }
  let pulseIndex = 0
  let nextClickTime = context.currentTime + 0.04

  const scheduleClicks = () => {
    if (context.state === 'closed') {
      return
    }

    try {
      void context.resume().catch(() => undefined)
      while (nextClickTime < context.currentTime + scheduleAheadSeconds) {
        const quarterBeatOffset = pulseIndex * meter.pulseQuarterBeats
        const isDownbeat = isMeasureDownbeat(quarterBeatOffset, meter.beatsPerMeasure)
        session.nodes.push(
          createTone(
            context,
            nextClickTime,
            0.045,
            isDownbeat ? 1040 : 760,
            isDownbeat ? 0.052 : 0.038,
            'square',
          ),
        )
        pulseIndex += 1
        nextClickTime += pulseSeconds
      }
      const timeoutId = window.setTimeout(scheduleClicks, lookaheadMilliseconds)
      session.timeoutIds.push(timeoutId)
    } catch {
      disposePlaybackSession(session)
    }
  }

  scheduleClicks()
  return session
}

export function disposePlaybackSession(session: PlaybackSession | null) {
  if (!session) {
    return
  }

  session.timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId))
  session.nodes.forEach(({ filters, media, oscillator, oscillators, source, gain, gains }) => {
    try {
      if (media) {
        media.pause()
        media.removeAttribute('src')
        media.load()
      }
      ;[gain, ...(gains ?? [])].forEach((currentGain) => {
        currentGain?.gain.cancelScheduledValues(0)
        currentGain?.gain.setValueAtTime(0.0001, session.context?.currentTime ?? 0)
      })
      oscillator?.stop()
      oscillator?.disconnect()
      oscillators?.forEach((currentOscillator) => {
        currentOscillator.stop()
        currentOscillator.disconnect()
      })
      source?.stop()
      source?.disconnect()
      gain?.disconnect()
      gains?.forEach((currentGain) => currentGain.disconnect())
      filters?.forEach((filter) => filter.disconnect())
    } catch {
      return
    }
  })

  if (session.context && session.context.state !== 'closed') {
    void session.context.close().catch(() => undefined)
  }
}

export function scheduleMetronomeClicks(
  context: AudioContext,
  nodes: PlaybackNode[],
  scheduledStart: number,
  maxBeat: number,
  bpm: number,
  meter: MeterContext,
  volume: number,
): number {
  const beatSeconds = getBeatSeconds(bpm)
  let latestStop = 0
  for (
    let quarterBeatOffset = 0;
    quarterBeatOffset <= Math.max(0, maxBeat - 1) + 0.001;
    quarterBeatOffset += meter.pulseQuarterBeats
  ) {
    const clickStart = quarterBeatOffset * beatSeconds
    const frequency = isMeasureDownbeat(quarterBeatOffset, meter.beatsPerMeasure) ? 960 : 720
    nodes.push(createTone(context, scheduledStart + clickStart, 0.045, frequency, volume, 'square'))
    latestStop = Math.max(latestStop, clickStart + 0.045)
  }
  return latestStop
}

export async function fetchAudioArrayBuffer(audioUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(audioUrl)
  if (!response.ok) {
    throw new Error('녹음 원본 파일을 불러오지 못했습니다.')
  }
  return response.arrayBuffer()
}
