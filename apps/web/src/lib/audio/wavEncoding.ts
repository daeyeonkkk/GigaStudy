export function encodeAudioBufferToWavDataUrl(audioBuffer: AudioBuffer): string {
  const sampleCount = audioBuffer.length
  if (sampleCount === 0) {
    throw new Error('오디오 샘플이 비어 있습니다.')
  }

  const channelCount = Math.max(1, audioBuffer.numberOfChannels)
  const monoSamples = new Float32Array(sampleCount)
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelData = audioBuffer.getChannelData(channelIndex)
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      monoSamples[sampleIndex] += channelData[sampleIndex] / channelCount
    }
  }

  return encodeMonoPcm16WavDataUrl(monoSamples, audioBuffer.sampleRate)
}

export function encodeAudioChunksToWavDataUrl(chunks: Float32Array[], sampleRate: number): string {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const samples = new Float32Array(sampleCount)
  let offset = 0

  chunks.forEach((chunk) => {
    samples.set(chunk, offset)
    offset += chunk.length
  })

  return encodeMonoPcm16WavDataUrl(samples, sampleRate)
}

export function encodeMonoPcm16WavDataUrl(samples: Float32Array, sampleRate: number): string {
  const bytesPerSample = 2
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample)
  const view = new DataView(buffer)
  let offset = 0

  function writeString(value: string) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset, value.charCodeAt(index))
      offset += 1
    }
  }

  writeString('RIFF')
  view.setUint32(offset, 36 + samples.length * bytesPerSample, true)
  offset += 4
  writeString('WAVE')
  writeString('fmt ')
  view.setUint32(offset, 16, true)
  offset += 4
  view.setUint16(offset, 1, true)
  offset += 2
  view.setUint16(offset, 1, true)
  offset += 2
  view.setUint32(offset, sampleRate, true)
  offset += 4
  view.setUint32(offset, sampleRate * bytesPerSample, true)
  offset += 4
  view.setUint16(offset, bytesPerSample, true)
  offset += 2
  view.setUint16(offset, 16, true)
  offset += 2
  writeString('data')
  view.setUint32(offset, samples.length * bytesPerSample, true)
  offset += 4

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += bytesPerSample
  }

  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }

  return `data:audio/wav;base64,${btoa(binary)}`
}
