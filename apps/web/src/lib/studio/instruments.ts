export type PlaybackNode = {
  filters?: BiquadFilterNode[]
  oscillator?: OscillatorNode
  oscillators?: OscillatorNode[]
  panners?: StereoPannerNode[]
  source?: AudioBufferSourceNode
  sources?: AudioBufferSourceNode[]
  gain?: GainNode
  gains?: GainNode[]
}

export type DecodedInstrumentSampleLayer = {
  buffer: AudioBuffer
  gain?: number
  loopEndSeconds?: number
  loopStartSeconds?: number
  pan?: number
  releaseSeconds?: number
  rootFrequency: number
}

export type DecodedInstrumentSample = DecodedInstrumentSampleLayer & {
  attackSeconds?: number
  layers?: DecodedInstrumentSampleLayer[]
  tone?: SampledInstrumentTone
}

export type SampledInstrumentTone = {
  highpassFrequency?: number
  highShelfFrequency?: number
  highShelfGainDb?: number
  lowShelfFrequency?: number
  lowShelfGainDb?: number
  peakingFrequency?: number
  peakingGainDb?: number
  peakingQ?: number
}

export type SynthVoiceId = 'guide-sustain' | 'plucked-reference' | 'percussion-click'

export type SynthPlaybackInstrument = {
  id: string
  kind: 'synth'
  label: string
  voice: SynthVoiceId
}

export type SampledPlaybackInstrument = {
  fallback?: SynthPlaybackInstrument
  id: string
  kind: 'sampled'
  label: string
  resolveSample: (frequency: number) => DecodedInstrumentSample | null
}

export type PlaybackInstrument = SampledPlaybackInstrument | SynthPlaybackInstrument

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
  label: '연습용 지속음',
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
  if (instrument.kind === 'sampled') {
    const sample = instrument.resolveSample(request.frequency)
    if (sample) {
      return createSampledInstrumentPlayback(context, request, sample)
    }
    return createSynthInstrumentPlayback(
      context,
      request,
      instrument.fallback ?? GUIDE_SUSTAIN_INSTRUMENT,
    )
  }
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

function createSampledInstrumentPlayback(
  context: AudioContext,
  request: InstrumentPlaybackRequest,
  sample: DecodedInstrumentSample,
): PlaybackNode {
  const destination = request.destination ?? context.destination
  const filters: BiquadFilterNode[] = []
  const panners: StereoPannerNode[] = []
  const sources: AudioBufferSourceNode[] = []
  const gain = context.createGain()
  const gains: GainNode[] = [gain]
  const duration = Math.max(0.03, request.duration)
  const releaseTime = Math.max(
    0.08,
    sample.releaseSeconds ?? Math.min(0.32, Math.max(0.16, duration * 0.18)),
  )
  const attackTime = Math.min(
    Math.max(0.001, sample.attackSeconds ?? 0.012),
    Math.max(0.001, duration * 0.3),
  )
  const sampleGain = sample.gain ?? 1
  const layers = sample.layers?.length ? sample.layers : [sample]

  gain.gain.setValueAtTime(0.0001, request.startTime)
  gain.gain.linearRampToValueAtTime(request.volume * sampleGain, request.startTime + attackTime)
  gain.gain.setValueAtTime(request.volume * sampleGain, request.startTime + duration)
  gain.gain.exponentialRampToValueAtTime(0.0001, request.startTime + duration + releaseTime)

  layers.forEach((layer) => {
    const source = context.createBufferSource()
    const layerGain = layer.gain ?? 1
    const loopStartSeconds = layer.loopStartSeconds ?? null
    const loopEndSeconds = layer.loopEndSeconds ?? null
    const hasLoop =
      loopStartSeconds !== null &&
      loopEndSeconds !== null &&
      loopEndSeconds > loopStartSeconds + 0.02 &&
      loopEndSeconds <= layer.buffer.duration + 0.01

    source.buffer = layer.buffer
    if (hasLoop) {
      source.loop = true
      source.loopStart = Math.max(0, loopStartSeconds)
      source.loopEnd = Math.min(layer.buffer.duration, loopEndSeconds)
    }
    source.playbackRate.setValueAtTime(request.frequency / layer.rootFrequency, request.startTime)

    const layerOutput = connectSampleToneChain(context, source, sample.tone, request.startTime, filters)
    if (layer.pan !== undefined && Number.isFinite(layer.pan)) {
      const panner = context.createStereoPanner()
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, layer.pan)), request.startTime)
      const layerLevel = context.createGain()
      layerLevel.gain.setValueAtTime(layerGain, request.startTime)
      layerOutput.connect(panner)
      panner.connect(layerLevel)
      layerLevel.connect(gain)
      gains.push(layerLevel)
      panners.push(panner)
    } else if (layerGain !== 1) {
      const layerLevel = context.createGain()
      layerLevel.gain.setValueAtTime(layerGain, request.startTime)
      layerOutput.connect(layerLevel)
      layerLevel.connect(gain)
      gains.push(layerLevel)
    } else {
      layerOutput.connect(gain)
    }

    source.start(request.startTime)
    source.stop(request.startTime + duration + releaseTime + 0.04)
    sources.push(source)
  })

  gain.connect(destination)

  return { filters, gain, gains, panners, source: sources[0], sources }
}

function connectSampleToneChain(
  context: AudioContext,
  source: AudioBufferSourceNode,
  tone: SampledInstrumentTone | undefined,
  startTime: number,
  filters: BiquadFilterNode[],
): AudioNode {
  let tail: AudioNode = source

  const appendFilter = (
    type: BiquadFilterType,
    frequency: number | undefined,
    gainDb?: number,
    q?: number,
  ) => {
    if (!frequency || frequency <= 0) {
      return
    }
    const filter = context.createBiquadFilter()
    filter.type = type
    filter.frequency.setValueAtTime(frequency, startTime)
    if (gainDb !== undefined) {
      filter.gain.setValueAtTime(gainDb, startTime)
    }
    if (q !== undefined) {
      filter.Q.setValueAtTime(q, startTime)
    }
    tail.connect(filter)
    tail = filter
    filters.push(filter)
  }

  appendFilter('highpass', tone?.highpassFrequency, undefined, 0.65)
  appendFilter('lowshelf', tone?.lowShelfFrequency, tone?.lowShelfGainDb)
  appendFilter('peaking', tone?.peakingFrequency, tone?.peakingGainDb, tone?.peakingQ)
  appendFilter('highshelf', tone?.highShelfFrequency, tone?.highShelfGainDb)

  return tail
}

function createGuideSustainTone(
  context: AudioContext,
  request: InstrumentPlaybackRequest,
): PlaybackNode {
  const destination = request.destination ?? context.destination
  const filter = context.createBiquadFilter()
  const masterGain = context.createGain()
  const duration = Math.max(0.06, request.duration)
  const attackTime = Math.min(0.04, duration * 0.24)
  const releaseTime = Math.max(0.1, Math.min(0.22, duration * 0.2))
  const holdEndTime = request.startTime + Math.max(attackTime + 0.02, duration)
  const oscillators: OscillatorNode[] = []
  const gains: GainNode[] = [masterGain]

  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(Math.min(6200, Math.max(1800, request.frequency * 10)), request.startTime)
  filter.Q.setValueAtTime(0.35, request.startTime)

  masterGain.gain.setValueAtTime(0.0001, request.startTime)
  masterGain.gain.linearRampToValueAtTime(request.volume, request.startTime + attackTime)
  masterGain.gain.setValueAtTime(request.volume * 0.86, holdEndTime)
  masterGain.gain.exponentialRampToValueAtTime(0.0001, holdEndTime + releaseTime)

  filter.connect(masterGain)
  masterGain.connect(destination)

  const partials: Array<{ detune: number; gain: number; ratio: number; type: OscillatorType }> = [
    { detune: -5, gain: 0.72, ratio: 1, type: 'sine' },
    { detune: 4, gain: 0.38, ratio: 1, type: 'triangle' },
    { detune: 0, gain: 0.12, ratio: 2, type: 'sine' },
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
