import {
  GUIDE_SUSTAIN_INSTRUMENT,
  type DecodedInstrumentSample,
  type SampledPlaybackInstrument,
} from './instruments'

type SynthPadChoirRegion = {
  hiMidi: number
  loMidi: number
  loopEndFrame: number
  loopStartFrame: number
  rootMidi: number
  samplePath: string
}

type LoadedSynthPadChoirRegion = SynthPadChoirRegion & DecodedInstrumentSample

const SYNTH_PAD_CHOIR_BASE_PATH = '/instruments/freepats-synth-pad-choir'
const SYNTH_PAD_CHOIR_SAMPLE_RATE = 44100
const SYNTH_PAD_CHOIR_RELEASE_SECONDS = 0.28

const SYNTH_PAD_CHOIR_REGIONS: SynthPadChoirRegion[] = [
  {
    hiMidi: 38,
    loMidi: 33,
    loopEndFrame: 299519,
    loopStartFrame: 119520,
    rootMidi: 36,
    samplePath: 'samples/C2.wav',
  },
  {
    hiMidi: 44,
    loMidi: 39,
    loopEndFrame: 299519,
    loopStartFrame: 119520,
    rootMidi: 42,
    samplePath: 'samples/Fsharp2.wav',
  },
  {
    hiMidi: 50,
    loMidi: 45,
    loopEndFrame: 299519,
    loopStartFrame: 119520,
    rootMidi: 48,
    samplePath: 'samples/C3.wav',
  },
  {
    hiMidi: 56,
    loMidi: 51,
    loopEndFrame: 299519,
    loopStartFrame: 119520,
    rootMidi: 54,
    samplePath: 'samples/Fsharp3.wav',
  },
  {
    hiMidi: 62,
    loMidi: 57,
    loopEndFrame: 299519,
    loopStartFrame: 119520,
    rootMidi: 60,
    samplePath: 'samples/C4.wav',
  },
  {
    hiMidi: 68,
    loMidi: 63,
    loopEndFrame: 299519,
    loopStartFrame: 119520,
    rootMidi: 66,
    samplePath: 'samples/Fsharp4.wav',
  },
  {
    hiMidi: 74,
    loMidi: 69,
    loopEndFrame: 299519,
    loopStartFrame: 119520,
    rootMidi: 72,
    samplePath: 'samples/C5.wav',
  },
  {
    hiMidi: 80,
    loMidi: 75,
    loopEndFrame: 299519,
    loopStartFrame: 119520,
    rootMidi: 78,
    samplePath: 'samples/Fsharp5.wav',
  },
  {
    hiMidi: 86,
    loMidi: 81,
    loopEndFrame: 299519,
    loopStartFrame: 119520,
    rootMidi: 84,
    samplePath: 'samples/C6.wav',
  },
  {
    hiMidi: 91,
    loMidi: 87,
    loopEndFrame: 299519,
    loopStartFrame: 119520,
    rootMidi: 90,
    samplePath: 'samples/Fsharp6.wav',
  },
  {
    hiMidi: 97,
    loMidi: 92,
    loopEndFrame: 299519,
    loopStartFrame: 119520,
    rootMidi: 96,
    samplePath: 'samples/C7.wav',
  },
  {
    hiMidi: 108,
    loMidi: 98,
    loopEndFrame: 299519,
    loopStartFrame: 119520,
    rootMidi: 102,
    samplePath: 'samples/Fsharp7.wav',
  },
]

const synthPadChoirCache = new WeakMap<AudioContext, Promise<SampledPlaybackInstrument>>()

export function loadSynthPadChoirInstrument(context: AudioContext): Promise<SampledPlaybackInstrument> {
  const cachedInstrument = synthPadChoirCache.get(context)
  if (cachedInstrument) {
    return cachedInstrument
  }

  const instrumentPromise = createSynthPadChoirInstrument(context).catch((error: unknown) => {
    synthPadChoirCache.delete(context)
    throw error
  })
  synthPadChoirCache.set(context, instrumentPromise)
  return instrumentPromise
}

async function createSynthPadChoirInstrument(
  context: AudioContext,
): Promise<SampledPlaybackInstrument> {
  const loadedRegions = await Promise.all(
    SYNTH_PAD_CHOIR_REGIONS.map((region) => loadSynthPadChoirRegion(context, region)),
  )

  return {
    fallback: GUIDE_SUSTAIN_INSTRUMENT,
    id: 'freepats-synth-pad-choir',
    kind: 'sampled',
    label: 'FreePats Synth Pad Choir',
    resolveSample: (frequency) => findSynthPadChoirSample(loadedRegions, frequency),
  }
}

async function loadSynthPadChoirRegion(
  context: AudioContext,
  region: SynthPadChoirRegion,
): Promise<LoadedSynthPadChoirRegion> {
  const response = await fetch(`${SYNTH_PAD_CHOIR_BASE_PATH}/${region.samplePath}`)
  if (!response.ok) {
    throw new Error(`Unable to load instrument sample: ${region.samplePath}`)
  }

  const buffer = await context.decodeAudioData(await response.arrayBuffer())
  const loopStartSeconds = region.loopStartFrame / SYNTH_PAD_CHOIR_SAMPLE_RATE
  const loopEndSeconds = region.loopEndFrame / SYNTH_PAD_CHOIR_SAMPLE_RATE

  return {
    ...region,
    buffer,
    gain: 1,
    loopEndSeconds: Math.min(buffer.duration, loopEndSeconds),
    loopStartSeconds: Math.min(buffer.duration, loopStartSeconds),
    releaseSeconds: SYNTH_PAD_CHOIR_RELEASE_SECONDS,
    rootFrequency: midiToFrequency(region.rootMidi),
  }
}

function findSynthPadChoirSample(
  loadedRegions: LoadedSynthPadChoirRegion[],
  frequency: number,
): DecodedInstrumentSample | null {
  const midi = Math.round(frequencyToMidi(frequency))
  const matchingRegion = loadedRegions.find((region) => region.loMidi <= midi && region.hiMidi >= midi)
  if (matchingRegion) {
    return matchingRegion
  }

  return (
    loadedRegions.reduce<LoadedSynthPadChoirRegion | null>((bestRegion, region) => {
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
