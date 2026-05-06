import { STUDIO_TIME_PRECISION_SECONDS } from './timing'

export type PlaybackNode = {
  filters?: BiquadFilterNode[]
  oscillator?: OscillatorNode
  oscillators?: OscillatorNode[]
  source?: AudioBufferSourceNode
  gain?: GainNode
  gains?: GainNode[]
}

export type SynthVoiceId = 'guide-sustain' | 'plucked-reference' | 'percussion-click'

export type SynthPlaybackInstrument = {
  id: string
  kind: 'synth'
  label: string
  voice: SynthVoiceId
}

export type SamplePlaybackInstrument = {
  audioBuffer: AudioBuffer
  id: string
  kind: 'sample'
  label: string
  rootFrequency: number
}

export type PlaybackInstrument = SynthPlaybackInstrument | SamplePlaybackInstrument

export type InstrumentPlaybackRequest = {
  destination?: AudioNode
  duration: number
  frequency: number
  gridUnitSeconds?: number
  instrument?: PlaybackInstrument
  nextGapSeconds?: number
  startTime: number
  volume: number
}

export type ScheduledGuideTone = {
  duration: number
  frequency: number
  gridUnitSeconds?: number
  nextGapSeconds?: number
  startTime: number
  volume: number
}

export type MelodicEnvelope = {
  attackSeconds: number
  endGainRatio: number
  peakGainRatio: number
  releaseSeconds: number
}

export const GUIDE_SUSTAIN_INSTRUMENT: SynthPlaybackInstrument = {
  id: 'guide-sustain',
  kind: 'synth',
  label: '따뜻한 기준음',
  voice: 'guide-sustain',
}

export const PLUCKED_REFERENCE_INSTRUMENT: SynthPlaybackInstrument = {
  id: 'plucked-reference',
  kind: 'synth',
  label: '짧은 기준음',
  voice: 'plucked-reference',
}

export const PERCUSSION_CLICK_INSTRUMENT: SynthPlaybackInstrument = {
  id: 'percussion-click',
  kind: 'synth',
  label: '퍼커션 클릭',
  voice: 'percussion-click',
}

export const DEFAULT_MELODIC_INSTRUMENT = GUIDE_SUSTAIN_INSTRUMENT
export const DEFAULT_PERCUSSION_INSTRUMENT = PERCUSSION_CLICK_INSTRUMENT

export function createInstrumentPlayback(
  context: AudioContext,
  request: InstrumentPlaybackRequest,
): PlaybackNode {
  const instrument = request.instrument ?? GUIDE_SUSTAIN_INSTRUMENT
  if (instrument.kind === 'sample') {
    return createSampleInstrumentPlayback(context, request, instrument)
  }
  return createSynthInstrumentPlayback(context, request, instrument)
}

function getPlaybackDuration(requestedDuration: number): number {
  return Math.max(STUDIO_TIME_PRECISION_SECONDS, requestedDuration)
}

function getReleaseTime(duration: number, ratio: number, maxSeconds: number): number {
  return Math.min(maxSeconds, Math.max(STUDIO_TIME_PRECISION_SECONDS, duration * ratio))
}

function clampValue(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function getEnvelopeGridUnitSeconds(duration: number, gridUnitSeconds?: number): number {
  if (gridUnitSeconds !== undefined && Number.isFinite(gridUnitSeconds) && gridUnitSeconds > 0) {
    return Math.max(STUDIO_TIME_PRECISION_SECONDS, gridUnitSeconds)
  }
  return Math.max(STUDIO_TIME_PRECISION_SECONDS, duration)
}

export function computeMelodicEnvelope(
  requestedDuration: number,
  gridUnitSeconds?: number,
  nextGapSeconds?: number,
): MelodicEnvelope {
  const duration = getPlaybackDuration(requestedDuration)
  const gridUnit = getEnvelopeGridUnitSeconds(duration, gridUnitSeconds)
  const precisionFloorSeconds = STUDIO_TIME_PRECISION_SECONDS * 6
  const attackFloorSeconds = Math.min(duration * 0.35, precisionFloorSeconds)
  const attackCeilingSeconds = Math.max(
    attackFloorSeconds,
    Math.min(duration * 0.45, gridUnit * 0.12),
  )
  const attackSeconds = clampValue(duration * 0.08, attackFloorSeconds, attackCeilingSeconds)
  const gridUnits = Math.max(1, duration / gridUnit)
  const endGainRatio = clampValue(0.7 + 0.2 / gridUnits, 0.7, 0.9)
  const releaseFloorSeconds = Math.min(
    duration * 0.4,
    Math.max(precisionFloorSeconds, gridUnit * 0.04),
  )
  const naturalReleaseSeconds = Math.max(
    releaseFloorSeconds,
    Math.min(duration * 0.18, gridUnit * 0.5),
  )
  const gapLimitedReleaseSeconds =
    nextGapSeconds !== undefined && Number.isFinite(nextGapSeconds)
      ? Math.max(releaseFloorSeconds, Math.max(0, nextGapSeconds) + releaseFloorSeconds)
      : naturalReleaseSeconds
  const releaseSeconds = Math.min(naturalReleaseSeconds, gapLimitedReleaseSeconds)

  return {
    attackSeconds,
    endGainRatio,
    peakGainRatio: 1.1,
    releaseSeconds,
  }
}

function createSampleInstrumentPlayback(
  context: AudioContext,
  request: InstrumentPlaybackRequest,
  instrument: SamplePlaybackInstrument,
): PlaybackNode {
  const destination = request.destination ?? context.destination
  const source = context.createBufferSource()
  const gain = context.createGain()
  const duration = getPlaybackDuration(request.duration)
  const envelope = computeMelodicEnvelope(duration, request.gridUnitSeconds, request.nextGapSeconds)
  const playbackRate = Math.max(0.25, Math.min(4, request.frequency / instrument.rootFrequency))
  const holdEndTime = request.startTime + duration

  source.buffer = instrument.audioBuffer
  source.playbackRate.setValueAtTime(playbackRate, request.startTime)
  if (instrument.audioBuffer.duration > 0.18) {
    source.loop = true
    source.loopStart = Math.min(0.04, instrument.audioBuffer.duration * 0.2)
    source.loopEnd = instrument.audioBuffer.duration
  }

  gain.gain.setValueAtTime(0.0001, request.startTime)
  gain.gain.linearRampToValueAtTime(
    request.volume * envelope.peakGainRatio,
    request.startTime + envelope.attackSeconds,
  )
  gain.gain.linearRampToValueAtTime(request.volume * envelope.endGainRatio, holdEndTime)
  gain.gain.exponentialRampToValueAtTime(0.0001, holdEndTime + envelope.releaseSeconds)

  source.connect(gain)
  gain.connect(destination)
  source.start(request.startTime)
  source.stop(holdEndTime + envelope.releaseSeconds + 0.03)
  return { gain, source }
}

function createSynthInstrumentPlayback(
  context: AudioContext,
  request: InstrumentPlaybackRequest,
  instrument: SynthPlaybackInstrument,
): PlaybackNode {
  if (instrument.voice === 'guide-sustain') {
    return createGuideSustainTone(context, request)
  }
  if (instrument.voice === 'plucked-reference') {
    return createPluckedReferenceTone(context, request)
  }
  return createPercussionClickTone(context, request)
}

function createGuideSustainTone(
  context: AudioContext,
  request: InstrumentPlaybackRequest,
): PlaybackNode {
  const destination = request.destination ?? context.destination
  const filter = context.createBiquadFilter()
  const masterGain = context.createGain()
  const duration = getPlaybackDuration(request.duration)
  const envelope = computeMelodicEnvelope(duration, request.gridUnitSeconds, request.nextGapSeconds)
  const holdEndTime = request.startTime + duration
  const oscillators: OscillatorNode[] = []
  const gains: GainNode[] = [masterGain]

  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(Math.min(4200, Math.max(1450, request.frequency * 7.2)), request.startTime)
  filter.Q.setValueAtTime(0.28, request.startTime)

  masterGain.gain.setValueAtTime(0.0001, request.startTime)
  masterGain.gain.linearRampToValueAtTime(
    request.volume * envelope.peakGainRatio,
    request.startTime + envelope.attackSeconds,
  )
  masterGain.gain.linearRampToValueAtTime(request.volume * envelope.endGainRatio, holdEndTime)
  masterGain.gain.exponentialRampToValueAtTime(0.0001, holdEndTime + envelope.releaseSeconds)

  filter.connect(masterGain)
  masterGain.connect(destination)

  const partials: Array<{ detune: number; gain: number; ratio: number; type: OscillatorType }> = [
    { detune: -2, gain: 0.82, ratio: 1, type: 'sine' },
    { detune: 2, gain: 0.2, ratio: 1, type: 'triangle' },
    { detune: 0, gain: 0.055, ratio: 2, type: 'sine' },
  ]

  partials.forEach((partial) => {
    const oscillator = context.createOscillator()
    const partialGain = context.createGain()
    oscillator.type = partial.type
    oscillator.frequency.setValueAtTime(request.frequency * partial.ratio, request.startTime)
    oscillator.detune.setValueAtTime(partial.detune, request.startTime)
    partialGain.gain.setValueAtTime(partial.gain, request.startTime)
    oscillator.connect(partialGain)
    partialGain.connect(filter)
    oscillator.start(request.startTime)
    oscillator.stop(holdEndTime + envelope.releaseSeconds + 0.04)
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

export function createScheduledGuideTrackPlayback(
  context: AudioContext,
  tones: ScheduledGuideTone[],
  destination: AudioNode = context.destination,
): PlaybackNode | null {
  const scheduledTones = tones
    .filter((tone) => Number.isFinite(tone.startTime) && Number.isFinite(tone.frequency) && tone.duration > 0)
    .sort((left, right) => left.startTime - right.startTime)
  if (scheduledTones.length === 0) {
    return null
  }

  const filter = context.createBiquadFilter()
  const masterGain = context.createGain()
  const oscillators: OscillatorNode[] = []
  const gains: GainNode[] = [masterGain]
  const firstStartTime = scheduledTones[0].startTime
  let stopTime = firstStartTime

  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(3600, firstStartTime)
  filter.Q.setValueAtTime(0.28, firstStartTime)
  masterGain.gain.setValueAtTime(0.0001, Math.max(context.currentTime, firstStartTime - 0.01))
  filter.connect(masterGain)
  masterGain.connect(destination)

  const partials: Array<{ detune: number; gain: number; ratio: number; type: OscillatorType }> = [
    { detune: -2, gain: 0.82, ratio: 1, type: 'sine' },
    { detune: 2, gain: 0.2, ratio: 1, type: 'triangle' },
    { detune: 0, gain: 0.055, ratio: 2, type: 'sine' },
  ]

  partials.forEach((partial) => {
    const oscillator = context.createOscillator()
    const partialGain = context.createGain()
    oscillator.type = partial.type
    oscillator.detune.setValueAtTime(partial.detune, firstStartTime)
    partialGain.gain.setValueAtTime(partial.gain, firstStartTime)
    oscillator.connect(partialGain)
    partialGain.connect(filter)
    oscillators.push(oscillator)
    gains.push(partialGain)
  })

  scheduledTones.forEach((tone, index) => {
    const duration = getPlaybackDuration(tone.duration)
    const envelope = computeMelodicEnvelope(duration, tone.gridUnitSeconds, tone.nextGapSeconds)
    const startTime = tone.startTime
    const attackEndTime = startTime + envelope.attackSeconds
    const holdEndTime = startTime + duration
    const nextStartTime = scheduledTones[index + 1]?.startTime
    const shouldReleaseBeforeNext =
      nextStartTime === undefined || nextStartTime > holdEndTime + STUDIO_TIME_PRECISION_SECONDS * 3
    const releaseEndTime = shouldReleaseBeforeNext
      ? holdEndTime + envelope.releaseSeconds
      : holdEndTime

    oscillators.forEach((oscillator, oscillatorIndex) => {
      const partial = partials[oscillatorIndex]
      oscillator.frequency.setValueAtTime(tone.frequency * partial.ratio, startTime)
    })
    filter.frequency.setValueAtTime(Math.min(4200, Math.max(1450, tone.frequency * 7.2)), startTime)

    masterGain.gain.setValueAtTime(0.0001, startTime)
    masterGain.gain.linearRampToValueAtTime(tone.volume * envelope.peakGainRatio, attackEndTime)
    masterGain.gain.linearRampToValueAtTime(tone.volume * envelope.endGainRatio, holdEndTime)
    if (shouldReleaseBeforeNext) {
      masterGain.gain.exponentialRampToValueAtTime(0.0001, releaseEndTime)
    }
    stopTime = Math.max(stopTime, releaseEndTime)
  })

  oscillators.forEach((oscillator) => {
    oscillator.start(firstStartTime)
    oscillator.stop(stopTime + 0.04)
  })

  return {
    filters: [filter],
    gain: masterGain,
    gains,
    oscillators,
  }
}

function createPluckedReferenceTone(
  context: AudioContext,
  request: InstrumentPlaybackRequest,
): PlaybackNode {
  const destination = request.destination ?? context.destination
  const filter = context.createBiquadFilter()
  const masterGain = context.createGain()
  const duration = getPlaybackDuration(request.duration)
  const attackTime = Math.min(0.012, duration / 5)
  const decayTime = Math.min(duration * 0.5, 0.32)
  const releaseTime = getReleaseTime(duration, 0.28, 0.28)
  const oscillators: OscillatorNode[] = []
  const gains: GainNode[] = [masterGain]

  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(Math.min(5000, Math.max(1400, request.frequency * 8)), request.startTime)
  filter.Q.setValueAtTime(0.65, request.startTime)

  masterGain.gain.setValueAtTime(0.0001, request.startTime)
  masterGain.gain.linearRampToValueAtTime(request.volume, request.startTime + attackTime)
  masterGain.gain.exponentialRampToValueAtTime(
    Math.max(0.0001, request.volume * 0.2),
    request.startTime + attackTime + decayTime,
  )
  masterGain.gain.exponentialRampToValueAtTime(0.0001, request.startTime + duration + releaseTime)

  filter.connect(masterGain)
  masterGain.connect(destination)

  const partials: Array<{ gain: number; ratio: number; type: OscillatorType }> = [
    { gain: 0.78, ratio: 1, type: 'triangle' },
    { gain: 0.2, ratio: 2, type: 'sine' },
    { gain: 0.06, ratio: 3, type: 'sine' },
  ]

  partials.forEach((partial) => {
    const oscillator = context.createOscillator()
    const partialGain = context.createGain()
    oscillator.type = partial.type
    oscillator.frequency.setValueAtTime(request.frequency * partial.ratio, request.startTime)
    partialGain.gain.setValueAtTime(partial.gain, request.startTime)
    oscillator.connect(partialGain)
    partialGain.connect(filter)
    oscillator.start(request.startTime)
    oscillator.stop(request.startTime + duration + releaseTime + 0.03)
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

function createPercussionClickTone(
  context: AudioContext,
  request: InstrumentPlaybackRequest,
): PlaybackNode {
  const destination = request.destination ?? context.destination
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const duration = Math.min(0.12, getPlaybackDuration(request.duration))
  const attackTime = Math.min(0.01, duration / 3)

  oscillator.type = 'square'
  oscillator.frequency.setValueAtTime(request.frequency, request.startTime)
  gain.gain.setValueAtTime(0.0001, request.startTime)
  gain.gain.linearRampToValueAtTime(request.volume, request.startTime + attackTime)
  gain.gain.exponentialRampToValueAtTime(0.0001, request.startTime + duration)

  oscillator.connect(gain)
  gain.connect(destination)
  oscillator.start(request.startTime)
  oscillator.stop(request.startTime + duration + 0.03)

  return { gain, oscillator }
}
