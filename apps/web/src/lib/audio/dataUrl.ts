export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(',', 2)
  if (!header || !payload) {
    throw new Error('Invalid audio data URL.')
  }
  const mimeMatch = /^data:([^;]+);base64$/u.exec(header)
  const contentType = mimeMatch?.[1] || 'application/octet-stream'
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: contentType })
}
