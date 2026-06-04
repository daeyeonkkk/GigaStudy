import { describe, expect, it } from 'vitest'

import { ApiRequestError, shouldUseBase64UploadFallback } from '../../apps/web/src/lib/api'

describe('upload fallback policy', () => {
  it('does not retry 413 uploads as base64', () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' })

    expect(shouldUseBase64UploadFallback(new ApiRequestError('too large', 413), blob)).toBe(false)
  })

  it('does not retry large blobs even after a transient failure', () => {
    const blob = new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], { type: 'audio/webm' })

    expect(shouldUseBase64UploadFallback(new Error('network reset'), blob)).toBe(false)
  })

  it('allows a small base64 retry for transient direct upload failures', () => {
    const blob = new Blob(['audio'], { type: 'audio/wav' })

    expect(shouldUseBase64UploadFallback(new Error('network reset'), blob)).toBe(true)
  })
})
