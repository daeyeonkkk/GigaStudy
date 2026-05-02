import {
  GUIDE_SUSTAIN_INSTRUMENT,
  type DecodedInstrumentSample,
  type SampledInstrumentTone,
  type SampledPlaybackInstrument,
} from './instruments'

type DrawbarOrganRegion = {
  hiMidi: number
  loMidi: number
  loopEndFrame: number
  loopStartFrame: number
  rootMidi: number
  samplePath: string
}

type LoadedDrawbarOrganRegion = DrawbarOrganRegion & DecodedInstrumentSample

const DRAWBAR_ORGAN_BASE_PATH = '/instruments/freepats-drawbar-organ'
const DRAWBAR_ORGAN_GAIN = 1.04
const DRAWBAR_ORGAN_RELEASE_SECONDS = 0.08
const DRAWBAR_ORGAN_SAMPLE_RATE = 44100
const DRAWBAR_ORGAN_TONE: SampledInstrumentTone = {
  highpassFrequency: 105,
  highShelfFrequency: 3200,
  highShelfGainDb: 4.5,
  lowShelfFrequency: 260,
  lowShelfGainDb: -2.5,
  peakingFrequency: 1850,
  peakingGainDb: 2,
  peakingQ: 0.85,
}

const DRAWBAR_ORGAN_REGIONS: DrawbarOrganRegion[] = [
  {
    hiMidi: 37,
    loMidi: 33,
    loopEndFrame: 352899,
    loopStartFrame: 58165,
    rootMidi: 36,
    samplePath: 'samples/C2.wav',
  },
  {
    hiMidi: 41,
    loMidi: 38,
    loopEndFrame: 207103,
    loopStartFrame: 59903,
    rootMidi: 40,
    samplePath: 'samples/E2.wav',
  },
  {
    hiMidi: 45,
    loMidi: 42,
    loopEndFrame: 248751,
    loopStartFrame: 104618,
    rootMidi: 44,
    samplePath: 'samples/Gsharp2.wav',
  },
  {
    hiMidi: 49,
    loMidi: 46,
    loopEndFrame: 220551,
    loopStartFrame: 73860,
    rootMidi: 48,
    samplePath: 'samples/C3.wav',
  },
  {
    hiMidi: 53,
    loMidi: 50,
    loopEndFrame: 220667,
    loopStartFrame: 72699,
    rootMidi: 52,
    samplePath: 'samples/E3.wav',
  },
  {
    hiMidi: 57,
    loMidi: 54,
    loopEndFrame: 178239,
    loopStartFrame: 35211,
    rootMidi: 56,
    samplePath: 'samples/Gsharp3.wav',
  },
  {
    hiMidi: 61,
    loMidi: 58,
    loopEndFrame: 186172,
    loopStartFrame: 38804,
    rootMidi: 60,
    samplePath: 'samples/C4.wav',
  },
  {
    hiMidi: 65,
    loMidi: 62,
    loopEndFrame: 181759,
    loopStartFrame: 48435,
    rootMidi: 64,
    samplePath: 'samples/E4.wav',
  },
  {
    hiMidi: 69,
    loMidi: 66,
    loopEndFrame: 204131,
    loopStartFrame: 54553,
    rootMidi: 68,
    samplePath: 'samples/Gsharp4.wav',
  },
  {
    hiMidi: 73,
    loMidi: 70,
    loopEndFrame: 197631,
    loopStartFrame: 50253,
    rootMidi: 72,
    samplePath: 'samples/C5.wav',
  },
  {
    hiMidi: 77,
    loMidi: 74,
    loopEndFrame: 195298,
    loopStartFrame: 49295,
    rootMidi: 76,
    samplePath: 'samples/E5.wav',
  },
  {
    hiMidi: 81,
    loMidi: 78,
    loopEndFrame: 195806,
    loopStartFrame: 56418,
    rootMidi: 80,
    samplePath: 'samples/Gsharp5.wav',
  },
  {
    hiMidi: 85,
    loMidi: 82,
    loopEndFrame: 189951,
    loopStartFrame: 58367,
    rootMidi: 84,
    samplePath: 'samples/C6.wav',
  },
  {
    hiMidi: 89,
    loMidi: 86,
    loopEndFrame: 164351,
    loopStartFrame: 33023,
    rootMidi: 88,
    samplePath: 'samples/E6.wav',
  },
  {
    hiMidi: 93,
    loMidi: 90,
    loopEndFrame: 157590,
    loopStartFrame: 26693,
    rootMidi: 92,
    samplePath: 'samples/Gsharp6.wav',
  },
  {
    hiMidi: 98,
    loMidi: 94,
    loopEndFrame: 150015,
    loopStartFrame: 19071,
    rootMidi: 96,
    samplePath: 'samples/C7.wav',
  },
]

const drawbarOrganCache = new WeakMap<AudioContext, Promise<SampledPlaybackInstrument>>()

export function loadDrawbarOrganInstrument(context: AudioContext): Promise<SampledPlaybackInstrument> {
  const cachedInstrument = drawbarOrganCache.get(context)
  if (cachedInstrument) {
    return cachedInstrument
  }

  const instrumentPromise = createDrawbarOrganInstrument(context).catch((error: unknown) => {
    drawbarOrganCache.delete(context)
    throw error
  })
  drawbarOrganCache.set(context, instrumentPromise)
  return instrumentPromise
}

async function createDrawbarOrganInstrument(
  context: AudioContext,
): Promise<SampledPlaybackInstrument> {
  const loadedRegions = await Promise.all(
    DRAWBAR_ORGAN_REGIONS.map((region) => loadDrawbarOrganRegion(context, region)),
  )

  return {
    fallback: GUIDE_SUSTAIN_INSTRUMENT,
    id: 'freepats-drawbar-organ',
    kind: 'sampled',
    label: 'FreePats Drawbar Organ',
    resolveSample: (frequency) => findDrawbarOrganSample(loadedRegions, frequency),
  }
}

async function loadDrawbarOrganRegion(
  context: AudioContext,
  region: DrawbarOrganRegion,
): Promise<LoadedDrawbarOrganRegion> {
  const response = await fetch(`${DRAWBAR_ORGAN_BASE_PATH}/${region.samplePath}`)
  if (!response.ok) {
    throw new Error(`Unable to load instrument sample: ${region.samplePath}`)
  }

  const buffer = await context.decodeAudioData(await response.arrayBuffer())
  const loopStartSeconds = region.loopStartFrame / DRAWBAR_ORGAN_SAMPLE_RATE
  const loopEndSeconds = region.loopEndFrame / DRAWBAR_ORGAN_SAMPLE_RATE

  return {
    ...region,
    buffer,
    gain: DRAWBAR_ORGAN_GAIN,
    loopEndSeconds: Math.min(buffer.duration, loopEndSeconds),
    loopStartSeconds: Math.min(buffer.duration, loopStartSeconds),
    releaseSeconds: DRAWBAR_ORGAN_RELEASE_SECONDS,
    rootFrequency: midiToFrequency(region.rootMidi),
    tone: DRAWBAR_ORGAN_TONE,
  }
}

function findDrawbarOrganSample(
  loadedRegions: LoadedDrawbarOrganRegion[],
  frequency: number,
): DecodedInstrumentSample | null {
  const midi = Math.round(frequencyToMidi(frequency))
  const matchingRegion = loadedRegions.find((region) => region.loMidi <= midi && region.hiMidi >= midi)
  if (matchingRegion) {
    return matchingRegion
  }

  return (
    loadedRegions.reduce<LoadedDrawbarOrganRegion | null>((bestRegion, region) => {
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
