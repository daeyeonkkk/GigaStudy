import { getBrowserAudioContextConstructor } from '../audio/audioContext'
import {
  DEFAULT_METER,
  getBeatSeconds,
  isMeasureDownbeat,
  type MeterContext,
} from './timing'
import type { TrackSlot } from '../../types/studio'

export type PlaybackNode = {
  filters?: BiquadFilterNode[]
  oscillator?: OscillatorNode
  oscillators?: OscillatorNode[]
  source?: AudioBufferSourceNode
  gain?: GainNode
  gains?: GainNode[]
}

export type PlaybackSourceMode = 'audio' | 'score'

export type PlaybackSession = {
  context?: AudioContext
  firstPulseAtMs?: number
  nodes: PlaybackNode[]
  timeoutIds: number[]
}

const RETAINED_METRONOME_NODE_LIMIT = 64

export function createTone(
  context: AudioContext,
  startTime: number,
  duration: number,
  frequency: number,
  volume: number,
  type: OscillatorType | 'piano',
  destination: AudioNode = context.destination,
): PlaybackNode {
  if (type === 'piano') {
    return createPianoTone(context, startTime, duration, frequency, volume, destination)
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
  gain.connect(destination)
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
  destination: AudioNode,
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
  masterGain.connect(destination)

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
  destination: AudioNode = context.destination,
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
  gain.connect(destination)
  source.start(startTime, safeOffsetSeconds, duration)
  source.stop(startTime + duration + 0.03)

  return { source, gain }
}

export function trackHasPlayableScore(track: TrackSlot): boolean {
  return track.notes.some((note) => note.is_rest !== true)
}

export function trackHasPlayableAudio(track: TrackSlot): boolean {
  return Boolean(track.audio_source_path)
}

export function getPlaybackPreparationMessage(
  tracksToPlay: TrackSlot[],
  includeMetronome: boolean,
  playbackSource: PlaybackSourceMode,
): string {
  const audioCount = playbackSource === 'audio' ? tracksToPlay.filter(trackHasPlayableAudio).length : 0
  const scoreCount = tracksToPlay.filter(
    (track) =>
      !(playbackSource === 'audio' && trackHasPlayableAudio(track)) && trackHasPlayableScore(track),
  ).length
  const parts = [
    audioCount > 0 ? `원음 ${audioCount}개` : null,
    scoreCount > 0 ? `악보 음 ${scoreCount}개` : null,
    includeMetronome ? '메트로놈' : null,
  ].filter(Boolean)

  if (parts.length === 0) {
    return '재생 가능한 원음이나 악보 음을 확인합니다.'
  }
  if (parts.length === 1 && audioCount === 1) {
    return '녹음 원본을 불러옵니다. 기준 트랙이 없으면 거의 즉시 재생됩니다.'
  }
  return `${parts.join(', ')}을 준비한 뒤 하나의 시작점에서 동시에 재생합니다.`
}

export function getTrackVolumeScale(track: TrackSlot): number {
  const volumePercent = Number.isFinite(track.volume_percent) ? track.volume_percent : 100
  return Math.max(0, Math.min(100, Math.round(volumePercent))) / 100
}

export function getTrackTimelineDurationSeconds(track: TrackSlot, beatSeconds: number): number {
  const noteEndSeconds = Math.max(
    0,
    ...track.notes.map((note) => (note.beat - 1 + note.duration_beats) * beatSeconds),
  )
  if (Number.isFinite(track.duration_seconds) && track.duration_seconds > 0) {
    return Math.max(track.duration_seconds, noteEndSeconds)
  }
  return Math.max(0.25, noteEndSeconds)
}

export function startLoopingMetronomeSession(
  bpm: number,
  meter: MeterContext = DEFAULT_METER,
  startDelaySeconds = 0.04,
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
  const firstPulseDelaySeconds = Math.max(0.02, startDelaySeconds)
  const firstPulseAtMs = performance.now() + firstPulseDelaySeconds * 1000
  const lookaheadMilliseconds = 25
  const scheduleAheadSeconds = 0.12
  const session: PlaybackSession = { context, firstPulseAtMs, nodes: [], timeoutIds: [] }
  let pulseIndex = 0
  let nextClickTime = context.currentTime + firstPulseDelaySeconds

  const scheduleClicks = () => {
    if (context.state === 'closed') {
      return
    }

    try {
      session.timeoutIds = []
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
      if (session.nodes.length > RETAINED_METRONOME_NODE_LIMIT) {
        session.nodes.splice(0, session.nodes.length - RETAINED_METRONOME_NODE_LIMIT)
      }
      const timeoutId = window.setTimeout(scheduleClicks, lookaheadMilliseconds)
      session.timeoutIds = [timeoutId]
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
  session.nodes.forEach(({ filters, oscillator, oscillators, source, gain, gains }) => {
    try {
      new Set([gain, ...(gains ?? [])]).forEach((currentGain) => {
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

export function scheduleMetronomeClicksFromTimeline(
  context: AudioContext,
  nodes: PlaybackNode[],
  scheduledStart: number,
  startSeconds: number,
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
    const clickStartSeconds = quarterBeatOffset * beatSeconds
    if (clickStartSeconds + 0.045 < startSeconds) {
      continue
    }
    const relativeStartSeconds = Math.max(0, clickStartSeconds - startSeconds)
    const frequency = isMeasureDownbeat(quarterBeatOffset, meter.beatsPerMeasure) ? 960 : 720
    nodes.push(
      createTone(
        context,
        scheduledStart + relativeStartSeconds,
        0.045,
        frequency,
        volume,
        'square',
      ),
    )
    latestStop = Math.max(latestStop, relativeStartSeconds + 0.045)
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
