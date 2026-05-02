import {
  GUIDE_SUSTAIN_INSTRUMENT,
  type DecodedInstrumentSample,
  type DecodedInstrumentSampleLayer,
  type SampledInstrumentTone,
  type SampledPlaybackInstrument,
} from './instruments'

type PercussiveOrganLayerConfig = {
  loopEndFrame: number
  loopStartFrame: number
  pan: number
  samplePath: string
}

type PercussiveOrganRegion = {
  hiMidi: number
  layers: PercussiveOrganLayerConfig[]
  loMidi: number
  rootMidi: number
}

type LoadedPercussiveOrganRegion = Omit<PercussiveOrganRegion, 'layers'> & DecodedInstrumentSample

const PERCUSSIVE_ORGAN_BASE_PATH = '/instruments/freepats-percussive-organ'
const PERCUSSIVE_ORGAN_ATTACK_SECONDS = 0.004
const PERCUSSIVE_ORGAN_GAIN = 1
const PERCUSSIVE_ORGAN_LAYER_GAIN = 0.74
const PERCUSSIVE_ORGAN_RELEASE_SECONDS = 0.07
const PERCUSSIVE_ORGAN_SAMPLE_RATE = 44100
const PERCUSSIVE_ORGAN_TONE: SampledInstrumentTone = {
  highpassFrequency: 95,
  highShelfFrequency: 3400,
  highShelfGainDb: 2.8,
  lowShelfFrequency: 250,
  lowShelfGainDb: -2,
  peakingFrequency: 2100,
  peakingGainDb: 1.6,
  peakingQ: 0.9,
}

const PERCUSSIVE_ORGAN_REGIONS: PercussiveOrganRegion[] = [
  createStereoRegion(31, 37, 36, 'C2', 10258, 64232, 282065),
  createStereoRegion(38, 41, 40, 'E2', 33911, 36049, 171465),
  createStereoRegion(42, 45, 44, 'Gsharp2', 111526, 39285, 256449),
  createStereoRegion(46, 49, 48, 'C3', 142012, 143393, 257375),
  createStereoRegion(50, 53, 52, 'E3', 134137, 146394, 275973),
  createStereoRegion(54, 57, 56, 'Gsharp3', 55704, 16161, 198019),
  createStereoRegion(58, 61, 60, 'C4', 51767, 120556, 194072),
  createStereoRegion(62, 65, 64, 'E4', 164620, 164618, 237951),
  createStereoRegion(66, 69, 68, 'Gsharp4', 95867, 103515, 169371),
  createStereoRegion(70, 73, 72, 'C5', 109093, 107750, 184805),
  createStereoRegion(74, 77, 76, 'E5', 94723, 84042, 208365),
  createStereoRegion(78, 81, 80, 'Gsharp5', 152779, 138584, 218586),
  createStereoRegion(82, 85, 84, 'C6', 126647, 91644, 273754),
  createStereoRegion(86, 89, 88, 'E6', 117872, 129809, 215414),
  createStereoRegion(90, 93, 92, 'Gsharp6', 46499, 179559, 247173),
  createStereoRegion(94, 108, 96, 'C7', 143603, 47690, 244044),
]

const percussiveOrganCache = new WeakMap<AudioContext, Promise<SampledPlaybackInstrument>>()

export function loadPercussiveOrganInstrument(context: AudioContext): Promise<SampledPlaybackInstrument> {
  const cachedInstrument = percussiveOrganCache.get(context)
  if (cachedInstrument) {
    return cachedInstrument
  }

  const instrumentPromise = createPercussiveOrganInstrument(context).catch((error: unknown) => {
    percussiveOrganCache.delete(context)
    throw error
  })
  percussiveOrganCache.set(context, instrumentPromise)
  return instrumentPromise
}

async function createPercussiveOrganInstrument(
  context: AudioContext,
): Promise<SampledPlaybackInstrument> {
  const loadedRegions = await Promise.all(
    PERCUSSIVE_ORGAN_REGIONS.map((region) => loadPercussiveOrganRegion(context, region)),
  )

  return {
    fallback: GUIDE_SUSTAIN_INSTRUMENT,
    id: 'freepats-percussive-organ',
    kind: 'sampled',
    label: 'FreePats Percussive Organ',
    resolveSample: (frequency) => findPercussiveOrganSample(loadedRegions, frequency),
  }
}

async function loadPercussiveOrganRegion(
  context: AudioContext,
  region: PercussiveOrganRegion,
): Promise<LoadedPercussiveOrganRegion> {
  const layers = await Promise.all(
    region.layers.map((layer) => loadPercussiveOrganLayer(context, layer, region.rootMidi)),
  )
  const firstLayer = layers[0]
  if (!firstLayer) {
    throw new Error('Unable to load percussive organ region.')
  }

  return {
    ...region,
    attackSeconds: PERCUSSIVE_ORGAN_ATTACK_SECONDS,
    buffer: firstLayer.buffer,
    gain: PERCUSSIVE_ORGAN_GAIN,
    layers,
    releaseSeconds: PERCUSSIVE_ORGAN_RELEASE_SECONDS,
    rootFrequency: midiToFrequency(region.rootMidi),
    tone: PERCUSSIVE_ORGAN_TONE,
  }
}

async function loadPercussiveOrganLayer(
  context: AudioContext,
  layer: PercussiveOrganLayerConfig,
  rootMidi: number,
): Promise<DecodedInstrumentSampleLayer> {
  const response = await fetch(`${PERCUSSIVE_ORGAN_BASE_PATH}/${layer.samplePath}`)
  if (!response.ok) {
    throw new Error(`Unable to load instrument sample: ${layer.samplePath}`)
  }

  const buffer = await context.decodeAudioData(await response.arrayBuffer())
  const loopStartSeconds = layer.loopStartFrame / PERCUSSIVE_ORGAN_SAMPLE_RATE
  const loopEndSeconds = layer.loopEndFrame / PERCUSSIVE_ORGAN_SAMPLE_RATE

  return {
    buffer,
    gain: PERCUSSIVE_ORGAN_LAYER_GAIN,
    loopEndSeconds: Math.min(buffer.duration, loopEndSeconds),
    loopStartSeconds: Math.min(buffer.duration, loopStartSeconds),
    pan: layer.pan,
    releaseSeconds: PERCUSSIVE_ORGAN_RELEASE_SECONDS,
    rootFrequency: midiToFrequency(rootMidi),
  }
}

function createStereoRegion(
  loMidi: number,
  hiMidi: number,
  rootMidi: number,
  sampleName: string,
  rightLoopStartFrame: number,
  leftLoopStartFrame: number,
  loopEndFrame: number,
): PercussiveOrganRegion {
  return {
    hiMidi,
    layers: [
      {
        loopEndFrame,
        loopStartFrame: leftLoopStartFrame,
        pan: -1,
        samplePath: `samples/${sampleName}L.wav`,
      },
      {
        loopEndFrame,
        loopStartFrame: rightLoopStartFrame,
        pan: 1,
        samplePath: `samples/${sampleName}R.wav`,
      },
    ],
    loMidi,
    rootMidi,
  }
}

function findPercussiveOrganSample(
  loadedRegions: LoadedPercussiveOrganRegion[],
  frequency: number,
): DecodedInstrumentSample | null {
  const midi = Math.round(frequencyToMidi(frequency))
  const matchingRegion = loadedRegions.find((region) => region.loMidi <= midi && region.hiMidi >= midi)
  if (matchingRegion) {
    return matchingRegion
  }

  return (
    loadedRegions.reduce<LoadedPercussiveOrganRegion | null>((bestRegion, region) => {
      if (!bestRegion) {
        return region
      }
      return Math.abs(region.rootMidi - midi) < Math.abs(bestRegion.rootMidi - midi)
        ? region
        : bestRegion
    }, null) ?? null
  )
}

function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440)
}

function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}
