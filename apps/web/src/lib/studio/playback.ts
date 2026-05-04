import { getBrowserAudioContextConstructor } from '../audio/audioContext'
import {
  DEFAULT_METER,
  getBeatSeconds,
  isMeasureDownbeat,
  type MeterContext,
} from './timing'
import {
  createInstrumentPlayback,
  PERCUSSION_CLICK_INSTRUMENT,
  type PlaybackNode,
} from './instruments'
import type { ArrangementRegion, PitchEvent, TrackSlot } from '../../types/studio'

export type PlaybackSourceMode = 'audio' | 'events'

export type PlaybackSession = {
  context?: AudioContext
  firstPulseAtMs?: number
  nodes: PlaybackNode[]
  timeoutIds: number[]
}

const RETAINED_METRONOME_NODE_LIMIT = 64

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

export function regionsHavePlayableEvents(regions: ArrangementRegion[] | null | undefined): boolean {
  return Boolean(regions?.some((region) => regionHasPlayableEvents(region)))
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
  regionsBySlot: Map<number, ArrangementRegion[]> = new Map(),
): string {
  const audioCount = playbackSource === 'audio' ? tracksToPlay.filter(trackHasPlayableAudio).length : 0
  const eventCount = tracksToPlay.filter(
    (track) =>
      !(playbackSource === 'audio' && trackHasPlayableAudio(track)) &&
      regionsHavePlayableEvents(regionsBySlot.get(track.slot_id)),
  ).length
  const parts = [
    audioCount > 0 ? `원음 ${audioCount}개` : null,
    eventCount > 0 ? `음표 ${eventCount}개` : null,
    includeMetronome ? '메트로놈' : null,
  ].filter(Boolean)

  if (parts.length === 0) {
    return '재생 가능한 원음과 음표를 확인하는 중입니다.'
  }
  if (parts.length === 1 && audioCount === 1) {
    return '원음 파일을 불러오는 중입니다. 기준 트랙이 없으면 곧바로 재생됩니다.'
  }
  return `${parts.join(', ')}를 같은 타임라인 기준으로 준비합니다.`
}

export function getTrackVolumeScale(track: TrackSlot): number {
  const volumePercent = Number.isFinite(track.volume_percent) ? track.volume_percent : 100
  return getVolumeScaleFromPercent(volumePercent)
}

export function getVolumeScaleFromPercent(volumePercent: number): number {
  if (!Number.isFinite(volumePercent)) {
    return 1
  }
  return Math.max(0, Math.min(100, Math.round(volumePercent))) / 100
}

export function getRegionTimelineEndSeconds(region: ArrangementRegion): number {
  const eventEndSeconds = Math.max(
    0,
    ...region.pitch_events.map((event) => event.start_seconds + event.duration_seconds),
  )
  return Math.max(region.start_seconds + region.duration_seconds, eventEndSeconds)
}

export function getRegionsTimelineEndSeconds(regions: ArrangementRegion[] | null | undefined): number {
  return Math.max(0, ...(regions ?? []).map((region) => getRegionTimelineEndSeconds(region)))
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
          createInstrumentPlayback(
            context,
            {
              duration: 0.045,
              frequency: isDownbeat ? 1040 : 760,
              instrument: PERCUSSION_CLICK_INSTRUMENT,
              startTime: nextClickTime,
              volume: isDownbeat ? 0.052 : 0.038,
            },
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
      createInstrumentPlayback(
        context,
        {
          duration: 0.045,
          frequency,
          instrument: PERCUSSION_CLICK_INSTRUMENT,
          startTime: scheduledStart + relativeStartSeconds,
          volume,
        },
      ),
    )
    latestStop = Math.max(latestStop, relativeStartSeconds + 0.045)
  }
  return latestStop
}

export async function fetchAudioArrayBuffer(audioUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(audioUrl)
  if (!response.ok) {
    throw new Error('원음 파일을 불러오지 못했습니다.')
  }
  return response.arrayBuffer()
}
