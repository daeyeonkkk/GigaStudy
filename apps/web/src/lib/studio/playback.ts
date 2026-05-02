import { getBrowserAudioContextConstructor } from '../audio/audioContext'
import {
  DEFAULT_METER,
  getBeatSeconds,
  isMeasureDownbeat,
  type MeterContext,
} from './timing'
import type { ArrangementRegion, PitchEvent, TrackSlot } from '../../types/studio'

export type PlaybackNode = {
  filters?: BiquadFilterNode[]
  oscillator?: OscillatorNode
  oscillators?: OscillatorNode[]
  source?: AudioBufferSourceNode
  gain?: GainNode
  gains?: GainNode[]
}

export type PlaybackSourceMode = 'audio' | 'events'

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
    partialGain.gain.linearRampToValueAtTime(partial.gain, startTime + attackTime)
    partialGain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, partial.gain * 0.12),
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

export function regionHasPlayableEvents(region: ArrangementRegion | null | undefined): boolean {
  return Boolean(region?.pitch_events.some((event) => event.is_rest !== true))
}

const pitchClassSemitones: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

function parsePitchLabel(label: string): { octave: number; semitone: number } | null {
  const match = /^([A-G])([#b]?)(-?\d+)$/u.exec(label.trim())
  if (!match) {
    return null
  }

  const [, pitchName, accidental, octaveText] = match
  const octave = Number(octaveText)
  let semitone = pitchClassSemitones[pitchName]
  if (accidental === '#') {
    semitone += 1
  } else if (accidental === 'b') {
    semitone -= 1
  }

  return {
    octave,
    semitone: ((semitone % 12) + 12) % 12,
  }
}

function getPitchLabelFrequency(label: string): number | null {
  const parsed = parsePitchLabel(label)
  if (!parsed) {
    return null
  }

  const octaveOffset = parsed.octave - 4
  const pitchClassOffset = parsed.semitone - 9
  return 440 * 2 ** ((octaveOffset * 12 + pitchClassOffset) / 12)
}

function getPercussionFrequency(label: string): number {
  const normalized = label.toLowerCase()
  if (normalized.includes('kick')) {
    return 90
  }
  if (normalized.includes('snare')) {
    return 180
  }
  if (normalized.includes('hat')) {
    return 620
  }
  return 260
}

export function getPitchEventPlaybackFrequency(event: PitchEvent): number | null {
  if (event.is_rest === true) {
    return null
  }
  if (event.pitch_hz && Number.isFinite(event.pitch_hz)) {
    return event.pitch_hz
  }
  if (event.pitch_midi === 35 || event.label.toLowerCase().includes('kick')) {
    return getPercussionFrequency(event.label)
  }
  return getPitchLabelFrequency(event.label)
}

export function trackHasPlayableAudio(track: TrackSlot): boolean {
  return Boolean(track.audio_source_path)
}

export function getPlaybackPreparationMessage(
  tracksToPlay: TrackSlot[],
  includeMetronome: boolean,
  playbackSource: PlaybackSourceMode,
  regionsBySlot: Map<number, ArrangementRegion> = new Map(),
): string {
  const audioCount = playbackSource === 'audio' ? tracksToPlay.filter(trackHasPlayableAudio).length : 0
  const eventCount = tracksToPlay.filter(
    (track) =>
      !(playbackSource === 'audio' && trackHasPlayableAudio(track)) &&
      regionHasPlayableEvents(regionsBySlot.get(track.slot_id)),
  ).length
  const parts = [
    audioCount > 0 ? `audio ${audioCount}` : null,
    eventCount > 0 ? `pitch events ${eventCount}` : null,
    includeMetronome ? 'metronome' : null,
  ].filter(Boolean)

  if (parts.length === 0) {
    return 'Checking for playable audio or pitch events.'
  }
  if (parts.length === 1 && audioCount === 1) {
    return 'Loading the recorded audio. Playback will start almost immediately if no reference tracks are needed.'
  }
  return `${parts.join(', ')} will start together from one timeline point.`
}

export function getTrackVolumeScale(track: TrackSlot): number {
  const volumePercent = Number.isFinite(track.volume_percent) ? track.volume_percent : 100
  return Math.max(0, Math.min(100, Math.round(volumePercent))) / 100
}

export function getRegionTimelineEndSeconds(region: ArrangementRegion): number {
  const eventEndSeconds = Math.max(
    0,
    ...region.pitch_events.map((event) => event.start_seconds + event.duration_seconds),
  )
  return Math.max(region.start_seconds + region.duration_seconds, eventEndSeconds)
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
    throw new Error('Could not load the recorded audio file.')
  }
  return response.arrayBuffer()
}
