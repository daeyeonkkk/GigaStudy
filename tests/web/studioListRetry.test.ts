import { describe, expect, it } from 'vitest'

import {
  buildApiRetryNotice,
  buildApiSuccessNotice,
  getApiRetryDelayMs,
  getStudioListRetryDelayMs,
} from '../../apps/web/src/lib/studioListRetry'

describe('studio list retry timing', () => {
  it('backs off quickly and then keeps a capped retry interval', () => {
    expect(getStudioListRetryDelayMs(0)).toBe(1000)
    expect(getStudioListRetryDelayMs(1)).toBe(2000)
    expect(getStudioListRetryDelayMs(2)).toBe(4000)
    expect(getStudioListRetryDelayMs(3)).toBe(8000)
    expect(getStudioListRetryDelayMs(4)).toBe(15000)
    expect(getStudioListRetryDelayMs(99)).toBe(15000)
  })

  it('uses the first retry delay for invalid attempts', () => {
    expect(getStudioListRetryDelayMs(-1)).toBe(1000)
    expect(getStudioListRetryDelayMs(Number.NaN)).toBe(1000)
  })

  it('shares the generic API retry delay policy', () => {
    expect(getApiRetryDelayMs(2)).toBe(getStudioListRetryDelayMs(2))
  })

  it('builds progressive retry messages from the same policy inputs', () => {
    expect(buildApiRetryNotice('스튜디오 목록', 0, 1000, new Error('API 서버에 연결하지 못했습니다.'))).toMatchObject({
      tone: 'retrying',
    })
    expect(buildApiRetryNotice('스튜디오 목록', 3, 8000, new Error('API 서버에 연결하지 못했습니다.'))).toMatchObject({
      tone: 'failed',
    })
  })

  it('builds success messages with optional result counts', () => {
    expect(buildApiSuccessNotice('스튜디오 목록', 3).message).toContain('3개')
  })
})

