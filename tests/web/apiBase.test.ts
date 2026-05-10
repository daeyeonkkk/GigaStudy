import { describe, expect, it } from 'vitest'

import { resolveApiBaseUrlCandidates } from '../../apps/web/src/lib/api'

describe('API base URL resolution', () => {
  it('uses an explicit configured API URL first', () => {
    expect(
      resolveApiBaseUrlCandidates(
        'https://api.example.test/',
        'https://gigastudy-alpha.pages.dev',
        false,
      )[0],
    ).toBe('https://api.example.test')
  })

  it('uses the alpha Cloud Run API when a Pages build has no API env', () => {
    const candidates = resolveApiBaseUrlCandidates(undefined, 'https://gigastudy-alpha.pages.dev', false)

    expect(candidates[0]).toContain('gigastudy-api-alpha')
    expect(candidates).toContain('https://gigastudy-alpha.pages.dev')
  })

  it('keeps local development on the local API', () => {
    expect(resolveApiBaseUrlCandidates(undefined, 'http://127.0.0.1:5173', true)[0]).toBe(
      'http://127.0.0.1:8000',
    )
  })
})
