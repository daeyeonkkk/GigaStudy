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

export type PlaybackInstrument = SynthPlaybackInstrument

export type InstrumentPlaybackRequest = {
  destination?: AudioNode
  duration: number
  frequency: number
  instrument?: PlaybackInstrument
  startTime: number
  volume: number
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
  return createSynthInstrumentPlayback(context, request, instrument)
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
  const duration = Math.max(0.06, request.duration)
  const attackTime = Math.min(0.055, duration * 0.3)
  const releaseTime = Math.max(0.16, Math.min(0.34, duration * 0.24))
  const holdEndTime = request.startTime + Math.max(attackTime + 0.02, duration)
  const oscillators: OscillatorNode[] = []
  const gains: GainNode[] = [masterGain]

  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(Math.min(4200, Math.max(1450, request.frequency * 7.2)), request.startTime)
  filter.Q.setValueAtTime(0.28, request.startTime)

  masterGain.gain.setValueAtTime(0.0001, request.startTime)
  masterGain.gain.linearRampToValueAtTime(request.volume * 0.84, request.startTime + attackTime)
  masterGain.gain.setValueAtTime(request.volume * 0.74, holdEndTime)
  masterGain.gain.exponentialRampToValueAtTime(0.0001, holdEndTime + releaseTime)

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
    oscillator.stop(holdEndTime + releaseTime + 0.04)
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

function createPluckedReferenceTone(
  context: AudioContext,
  request: InstrumentPlaybackRequest,
): PlaybackNode {
  const destination = request.destination ?? context.destination
  const filter = context.createBiquadFilter()
  const masterGain = context.createGain()
  const duration = Math.max(0.08, request.duration)
  const attackTime = Math.min(0.012, duration / 5)
  const decayTime = Math.min(duration * 0.5, 0.32)
  const releaseTime = Math.max(0.1, Math.min(0.28, duration * 0.28))
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
  const duration = Math.max(0.035, Math.min(0.12, request.duration))
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
