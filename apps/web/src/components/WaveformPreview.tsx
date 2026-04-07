import type { AudioPreviewData } from '../lib/audioPreview'

type WaveformPreviewProps = {
  preview: AudioPreviewData
}

function buildWaveformPath(samples: number[], width: number, height: number): string {
  if (samples.length === 0) {
    return ''
  }

  const step = width / Math.max(samples.length - 1, 1)
  return samples
    .map((sample, index) => {
      const x = index * step
      const y = height / 2 - sample * (height * 0.42)
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

function buildContourPath(
  contour: Array<number | null>,
  width: number,
  height: number,
): string {
  if (contour.length === 0) {
    return ''
  }

  const minPitch = 80
  const maxPitch = 1000
  const step = width / Math.max(contour.length - 1, 1)
  const segments: string[] = []

  contour.forEach((value, index) => {
    if (value === null) {
      return
    }

    const clamped = Math.min(maxPitch, Math.max(minPitch, value))
    const normalized = (Math.log(clamped) - Math.log(minPitch)) / (Math.log(maxPitch) - Math.log(minPitch))
    const x = index * step
    const y = height - normalized * (height - 12) - 6
    segments.push(`${segments.length === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
  })

  return segments.join(' ')
}

export function WaveformPreview({ preview }: WaveformPreviewProps) {
  const width = 720
  const height = 180
  const waveformPath = buildWaveformPath(preview.waveform, width, height)
  const contourPath = buildContourPath(preview.contour, width, height)
  const contourPointCount = preview.contour.filter((value) => value !== null).length

  return (
    <div className="waveform-preview">
      <div className="waveform-preview__meta">
        <div className="mini-card">
          <span>Source</span>
          <strong>{preview.source === 'local' ? 'Local preview' : 'Reloaded from server audio'}</strong>
        </div>
        <div className="mini-card">
          <span>Duration</span>
          <strong>
            {preview.durationMs === null ? 'Unknown' : `${(preview.durationMs / 1000).toFixed(2)} sec`}
          </strong>
        </div>
        <div className="mini-card">
          <span>Contour points</span>
          <strong>{contourPointCount}</strong>
        </div>
      </div>

      <svg
        className="waveform-preview__chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Waveform and pitch contour preview"
      >
        <rect x="0" y="0" width={width} height={height} rx="18" />
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} />
        <path d={waveformPath} />
        {contourPath ? <path className="waveform-preview__contour" d={contourPath} /> : null}
      </svg>

      <p className="status-card__hint">
        Waveform is a browser-generated peak preview. Contour is a temporary pitch estimate for
        quick “did the take land” feedback.
      </p>
    </div>
  )
}
