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

function getPreviewPipelineLabel(preview: AudioPreviewData): string {
  switch (preview.pipeline) {
    case 'worker-wasm':
      return 'Worker + WASM'
    case 'worker-js-fallback':
      return '워커 대체 경로'
    case 'main-thread-fallback':
      return '메인 스레드 대체 경로'
    case 'server-artifact':
      return '서버 산출물'
    default:
      return preview.source === 'remote' ? '서버 산출물' : '브라우저 미리보기'
  }
}

export function WaveformPreview({ preview }: WaveformPreviewProps) {
  const width = 720
  const height = 180
  const waveformPath = buildWaveformPath(preview.waveform, width, height)
  const contourPath = buildContourPath(preview.contour, width, height)
  const contourPointCount = preview.contour.filter((value) => value !== null).length
  const pipelineLabel = getPreviewPipelineLabel(preview)

  return (
    <div className="waveform-preview">
      <div className="waveform-preview__meta">
        <div className="mini-card">
          <span>출처</span>
          <strong>{preview.source === 'local' ? '로컬 미리보기' : '저장된 오디오에서 다시 불러옴'}</strong>
        </div>
        <div className="mini-card">
          <span>길이</span>
          <strong>
            {preview.durationMs === null ? '알 수 없음' : `${(preview.durationMs / 1000).toFixed(2)}초`}
          </strong>
        </div>
        <div className="mini-card">
          <span>컨투어 포인트</span>
          <strong>{contourPointCount}</strong>
        </div>
        <div className="mini-card">
          <span>미리보기 처리 경로</span>
          <strong data-testid="waveform-preview-pipeline">{pipelineLabel}</strong>
        </div>
      </div>

      <svg
        className="waveform-preview__chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="파형과 피치 컨투어 미리보기"
      >
        <rect x="0" y="0" width={width} height={height} rx="18" />
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} />
        <path d={waveformPath} />
        {contourPath ? <path className="waveform-preview__contour" d={contourPath} /> : null}
      </svg>

      <p className="status-card__hint">
        파형은 빠르게 확인하는 연습용 미리보기이며 최종 채점 입력은 아닙니다. 컨투어는 테이크의
        큰 흐름을 빠르게 보여주고, 최종 note 분석은 서버 결과를 기준으로 합니다.
      </p>
    </div>
  )
}
