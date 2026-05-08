import { describe, expect, it } from 'vitest'

import { getStudioListRetryDelayMs } from '../../apps/web/src/lib/studioListRetry'

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
})

