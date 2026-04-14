import { readFile } from 'node:fs/promises'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const apiBaseUrl = 'http://127.0.0.1:8000'
const sampleRate = 32_000
const durationMs = 1_200

function buildMonoWavBuffer({
  frequencyHz,
  amplitude = 0.2,
}: {
  frequencyHz: number
  amplitude?: number
}): Buffer {
  const frameCount = Math.max(1, Math.round(sampleRate * (durationMs / 1000)))
  const bytesPerSample = 2
  const channelCount = 1
  const dataSize = frameCount * bytesPerSample * channelCount
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channelCount, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28)
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32)
  buffer.writeUInt16LE(bytesPerSample * 8, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const sample = Math.sin((2 * Math.PI * frequencyHz * frameIndex) / sampleRate)
    const pcm = Math.max(-1, Math.min(1, sample * amplitude)) * 32767
    buffer.writeInt16LE(Math.round(pcm), 44 + frameIndex * 2)
  }

  return buffer
}

async function uploadGuide(
  request: APIRequestContext,
  projectId: string,
  wavBuffer: Buffer,
): Promise<void> {
  const initResponse = await request.post(`${apiBaseUrl}/api/projects/${projectId}/guide/upload-url`, {
    data: {
      filename: 'guide.wav',
      content_type: 'audio/wav',
    },
  })
  expect(initResponse.ok()).toBeTruthy()
  const initPayload = (await initResponse.json()) as {
    track_id: string
    upload_url: string
  }

  const uploadResponse = await request.put(initPayload.upload_url, {
    data: wavBuffer,
    headers: {
      'Content-Type': 'audio/wav',
    },
  })
  expect(uploadResponse.ok()).toBeTruthy()

  const completeResponse = await request.post(`${apiBaseUrl}/api/projects/${projectId}/guide/complete`, {
    data: {
      track_id: initPayload.track_id,
      source_format: 'audio/wav',
      duration_ms: durationMs,
      actual_sample_rate: sampleRate,
    },
  })
  expect(completeResponse.ok()).toBeTruthy()
}

async function uploadTake(
  request: APIRequestContext,
  projectId: string,
  wavBuffer: Buffer,
): Promise<void> {
  const createResponse = await request.post(`${apiBaseUrl}/api/projects/${projectId}/tracks`, {
    data: {
      part_type: 'LEAD',
    },
  })
  expect(createResponse.ok()).toBeTruthy()
  const createPayload = (await createResponse.json()) as { track_id: string }

  const initResponse = await request.post(`${apiBaseUrl}/api/tracks/${createPayload.track_id}/upload-url`, {
    data: {
      filename: 'take.wav',
      content_type: 'audio/wav',
    },
  })
  expect(initResponse.ok()).toBeTruthy()
  const initPayload = (await initResponse.json()) as { upload_url: string }

  const uploadResponse = await request.put(initPayload.upload_url, {
    data: wavBuffer,
    headers: {
      'Content-Type': 'audio/wav',
    },
  })
  expect(uploadResponse.ok()).toBeTruthy()

  const completeResponse = await request.post(`${apiBaseUrl}/api/tracks/${createPayload.track_id}/complete`, {
    data: {
      source_format: 'audio/wav',
      duration_ms: durationMs,
      actual_sample_rate: sampleRate,
    },
  })
  expect(completeResponse.ok()).toBeTruthy()
}

async function getWithRetry(
  request: APIRequestContext,
  url: string,
  attempts = 3,
): Promise<Awaited<ReturnType<APIRequestContext['get']>>> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await request.get(url)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Unable to fetch ${url}`)
}

async function saveDeviceProfileFixture(
  request: APIRequestContext,
  suffix: string,
): Promise<void> {
  const response = await request.post(`${apiBaseUrl}/api/device-profiles`, {
    data: {
      browser: 'Safari',
      os: 'macOS',
      input_device_hash: `fixture-mic-${suffix}`,
      output_route: 'bluetooth-output',
      browser_user_agent: `Playwright Safari fixture ${suffix}`,
      requested_constraints: {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
        channelCount: 1,
      },
      applied_settings: {
        sampleRate: 48000,
        channelCount: 1,
      },
      capabilities: {
        secure_context: true,
        media_devices: {
          get_user_media: true,
          enumerate_devices: true,
          get_supported_constraints: true,
          supported_constraints: ['channelCount', 'echoCancellation'],
        },
        permissions: {
          api_supported: true,
          microphone: 'prompt',
        },
        web_audio: {
          audio_context: true,
          audio_context_mode: 'webkit',
          offline_audio_context: false,
          offline_audio_context_mode: 'unavailable',
          output_latency_supported: false,
        },
        media_recorder: {
          supported: true,
          supported_mime_types: ['audio/mp4'],
          selected_mime_type: null,
        },
        audio_playback: {
          wav: 'probably',
          webm: 'unsupported',
          mp4: 'maybe',
          ogg: 'unsupported',
        },
      },
      diagnostic_flags: ['legacy_webkit_audio_context_only', 'missing_offline_audio_context'],
      actual_sample_rate: 48000,
      channel_count: 1,
      base_latency: 0.018,
      output_latency: 0.041,
    },
  })
  expect(response.ok()).toBeTruthy()
}

async function saveValidationRunFixture(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${apiBaseUrl}/api/admin/environment-validations`, {
    data: {
      label: '실기기 Safari 기준 실행',
      tester: 'Playwright 점검',
      device_name: 'MacBook Pro 14',
      os: 'macOS 15.4',
      browser: 'Safari 18',
      input_device: 'Built-in Microphone',
      output_route: 'AirPods Bluetooth',
      outcome: 'WARN',
      secure_context: true,
      microphone_permission_before: 'prompt',
      microphone_permission_after: 'granted',
      recording_mime_type: null,
      audio_context_mode: 'webkit',
      offline_audio_context_mode: 'unavailable',
      actual_sample_rate: 48000,
      base_latency: 0.018,
      output_latency: 0.041,
      warning_flags: ['legacy_webkit_audio_context_only', 'missing_offline_audio_context'],
      take_recording_succeeded: true,
      analysis_succeeded: true,
      playback_succeeded: false,
      follow_up: 'Safari 재생 대체 경로를 실기기에서 다시 확인합니다.',
      notes: '녹음 경로는 통과했지만 재생은 이 환경에서 제한되었습니다.',
      validated_at: new Date().toISOString(),
    },
  })
  expect(response.ok()).toBeTruthy()
}

async function createStudioProject(page: Page, title: string): Promise<string> {
  await page.goto('/')
  await page.getByTestId('project-title-input').fill(title)
  await page.getByTestId('base-key-input').fill('A')
  await page.getByTestId('open-studio-button').click()
  await expect(page).toHaveURL(/\/projects\/[^/]+\/studio$/)

  const projectIdMatch = page.url().match(/\/projects\/([^/]+)\/studio$/)
  expect(projectIdMatch).not.toBeNull()
  const projectId = projectIdMatch?.[1]
  if (!projectId) {
    throw new Error('Expected project id in studio URL.')
  }

  return projectId
}

async function seedGuideAndTake(
  page: Page,
  request: APIRequestContext,
  projectId: string,
): Promise<void> {
  const guideBuffer = buildMonoWavBuffer({ frequencyHz: 440 })
  const takeBuffer = buildMonoWavBuffer({ frequencyHz: 440 })

  await uploadGuide(request, projectId, guideBuffer)
  await uploadTake(request, projectId, takeBuffer)

  await page.reload()
  await expect(page.getByRole('heading', { name: '1번 테이크' })).toBeVisible()
}

async function seedGuideOnly(
  page: Page,
  request: APIRequestContext,
  projectId: string,
): Promise<void> {
  const guideBuffer = buildMonoWavBuffer({ frequencyHz: 440 })
  await uploadGuide(request, projectId, guideBuffer)
  await page.reload()
}

async function prepareBrowserRecording(page: Page): Promise<void> {
  await page.getByTestId('request-microphone-button').click()
  await expect(page.getByText(/마이크 권한을 허용했습니다\./)).toBeVisible()

  await page.getByTestId('save-device-profile-button').click()
  await expect(
    page.getByText(/장치 기록을 저장했고, 요청한 입력 설정과 실제 적용 결과도 함께 남겼습니다\./),
  ).toBeVisible()

  await page.getByTestId('count-in-select').selectOption('0')
  await page.getByTestId('metronome-recording-checkbox').uncheck()
}

async function recordBrowserTake(page: Page, takeNumber: number): Promise<void> {
  await page.getByTestId('start-take-button').click()
  await expect(page.getByText('녹음 중입니다. 테이크가 끝나면 중지해 주세요.', { exact: true })).toBeVisible()
  await expect(page.getByText('입력 표시가 켜졌습니다.', { exact: true })).toBeVisible()
  await page.waitForTimeout(1400)
  await page.getByTestId('stop-take-button').click()
  await expect(page.getByText(new RegExp(`${takeNumber}번 테이크 업로드가 완료되었습니다\\.`))).toBeVisible({
    timeout: 20000,
  })
  await expect(page.getByRole('heading', { name: `${takeNumber}번 테이크` })).toBeVisible()
}

async function runChordAwareAnalysis(page: Page): Promise<void> {
  await page.getByTestId('seed-chord-from-key-button').click()
  await page.getByTestId('save-chord-timeline-button').click()
  await expect(page.getByText(/코드 마커 1개를 저장했습니다\./)).toBeVisible()

  await page.getByTestId('run-post-analysis-button').click()
  await expect(page.getByText(/분석을 저장했습니다\./)).toBeVisible()
}

async function extractMelodyDraft(page: Page): Promise<void> {
  const melodyPanel = getMelodyExtractionPanel(page)
  await melodyPanel.getByTestId('extract-melody-button').click()
  await expect(melodyPanel.getByText(/멜로디 초안을 저장했습니다\./)).toBeVisible({
    timeout: 20000,
  })
}

async function generateArrangementCandidates(page: Page): Promise<void> {
  await page.getByTestId('generate-arrangements-button').click()
  await expect(page.getByText(/비교할 편곡 후보 \d+개를 준비했습니다\./)).toBeVisible({
    timeout: 20000,
  })
}

function getNoteFeedbackPanel(page: Page) {
  return page.getByTestId('note-feedback-panel')
}

function getShareLinksPanel(page: Page) {
  return page.getByTestId('share-links-panel')
}

function getArrangementEnginePanel(page: Page) {
  return page.getByTestId('arrangement-engine-panel')
}

function getMelodyExtractionPanel(page: Page) {
  return page.getByTestId('melody-panel')
}

function getScoreViewPanel(page: Page) {
  return page.getByTestId('score-view-panel')
}

function getRecorderPanel(page: Page) {
  return page.getByTestId('recorder-panel')
}

function getPlaybackPanel(page: Page) {
  return page.getByTestId('playback-panel')
}

function getTakeCard(page: Page, takeNumber: number) {
  return page
    .locator('article.take-card')
    .filter({ has: page.getByRole('heading', { name: `${takeNumber}번 테이크` }) })
    .first()
}

test('release gate smoke path reaches chord-aware note feedback through the studio', async ({
  page,
  request,
}) => {
  const projectId = await createStudioProject(page, 'Playwright release gate session')
  await seedGuideAndTake(page, request, projectId)
  await runChordAwareAnalysis(page)

  const noteFeedbackPanel = getNoteFeedbackPanel(page)
  await expect(noteFeedbackPanel.getByText('화음 기준', { exact: true })).toBeVisible()
  await expect(noteFeedbackPanel.getByText('음정 기준', { exact: true })).toBeVisible()
  await expect(noteFeedbackPanel.getByRole('button', { name: 'N1' })).toBeVisible()
  await expect(noteFeedbackPanel.getByRole('heading', { name: /1번 노트/i })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('download-human-rating-packet-button').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^gigastudy-.*-human-rating-packet\.zip$/)
  const downloadPath = await download.path()
  expect(downloadPath).toBeTruthy()
})

test('release gate share flow opens a frozen snapshot and loses access after deactivation', async ({
  page,
  request,
}) => {
  const projectId = await createStudioProject(page, 'Playwright share gate session')
  await seedGuideAndTake(page, request, projectId)
  await runChordAwareAnalysis(page)

  const shareLinksPanel = getShareLinksPanel(page)
  await shareLinksPanel.getByLabel('공유 이름').fill('Coach review')
  await page.getByRole('button', { name: '읽기 전용 공유 링크 만들기' }).click()
  await expect(page.getByText(/"Coach review" 읽기 전용 공유 링크를 만들었고/)).toBeVisible()

  const shareCard = shareLinksPanel.locator('article.history-card').filter({ hasText: 'Coach review' }).first()
  await expect(shareCard).toBeVisible()

  const popupPromise = page.waitForEvent('popup')
  await shareCard.getByRole('link', { name: '공유 화면 열기' }).click()
  const sharePage = await popupPromise
  await sharePage.waitForLoadState('domcontentloaded')

  await expect(sharePage).toHaveURL(/\/shared\//)
  await expect(sharePage.getByRole('heading', { name: 'Playwright share gate session' })).toBeVisible()
  await expect(sharePage.getByText('읽기 전용 공유', { exact: true })).toBeVisible()
  await expect(sharePage.getByRole('heading', { name: '선택한 원본 테이크' })).toBeVisible()
  await expect(sharePage.getByRole('heading', { name: '고정된 리뷰 스냅샷' })).toBeVisible()
  await expect(sharePage.getByRole('heading', { name: '녹음 결과 요약' })).toBeVisible()
  await expect(sharePage.getByText('Coach review', { exact: true })).toBeVisible()
  await expect(sharePage.getByText('1번 테이크', { exact: false })).toBeVisible()
  await expect(
    sharePage.getByText('이 화면은 고정된 리뷰 결과입니다. 수정, 재채점, 새 공유 링크 생성은 스튜디오에서 진행합니다.'),
  ).toBeVisible()
  await expect(sharePage.getByTestId('run-post-analysis-button')).toHaveCount(0)
  await expect(sharePage.getByRole('button', { name: '읽기 전용 공유 링크 만들기' })).toHaveCount(0)

  await shareCard.getByRole('button', { name: '비활성화' }).click()
  await expect(page.getByText(/"Coach review" 링크를 비활성화했습니다\./)).toBeVisible()

  await sharePage.reload()
  await expect(sharePage.getByRole('heading', { name: '공유 프로젝트를 열 수 없습니다' })).toBeVisible()
  await expect(sharePage.getByText('공유 링크가 비활성화되었습니다.')).toBeVisible()
})

test('release gate arrangement flow reaches export-ready score artifacts', async ({
  page,
  request,
}) => {
  const projectId = await createStudioProject(page, 'Playwright arrangement gate session')
  await seedGuideAndTake(page, request, projectId)
  await runChordAwareAnalysis(page)
  await extractMelodyDraft(page)
  await generateArrangementCandidates(page)

  const arrangementEnginePanel = getArrangementEnginePanel(page)
  await expect(arrangementEnginePanel.getByText('후보 3개', { exact: true })).toBeVisible()
  await expect(arrangementEnginePanel.getByText('A / B / C 비교', { exact: true })).toBeVisible()
  await expect(arrangementEnginePanel.locator('article.candidate-card')).toHaveCount(3)
  await expect(page.getByRole('link', { name: '편곡 MIDI 내보내기' }).first()).toBeVisible()

  const scoreViewPanel = getScoreViewPanel(page)
  await expect(scoreViewPanel.getByText('MusicXML 준비됨', { exact: true })).toBeVisible()

  const musicXmlLink = scoreViewPanel.getByRole('link', { name: 'MusicXML 내보내기' })
  const arrangementMidiLink = scoreViewPanel.getByRole('link', { name: '편곡 MIDI 내보내기' })
  const guideWavLink = scoreViewPanel.getByRole('link', { name: '가이드 WAV 내보내기' })

  await expect(musicXmlLink).toBeVisible()
  await expect(arrangementMidiLink).toBeVisible()
  await expect(guideWavLink).toBeVisible()

  const musicXmlHref = await musicXmlLink.getAttribute('href')
  const arrangementMidiHref = await arrangementMidiLink.getAttribute('href')
  const guideWavHref = await guideWavLink.getAttribute('href')

  expect(musicXmlHref).toBeTruthy()
  expect(arrangementMidiHref).toBeTruthy()
  expect(guideWavHref).toBeTruthy()

  const [musicXmlResponse, arrangementMidiResponse, guideWavResponse] = await Promise.all([
    getWithRetry(request, musicXmlHref!),
    getWithRetry(request, arrangementMidiHref!),
    getWithRetry(request, guideWavHref!),
  ])

  expect(musicXmlResponse.ok()).toBeTruthy()
  expect(arrangementMidiResponse.ok()).toBeTruthy()
  expect(guideWavResponse.ok()).toBeTruthy()

  expect((await musicXmlResponse.text()).includes('<score-partwise')).toBeTruthy()
  expect((await arrangementMidiResponse.body()).byteLength).toBeGreaterThan(32)
  expect((await guideWavResponse.body()).byteLength).toBeGreaterThan(32)
})

test('release gate arrangement workspace presents a score-first compare and export screen', async ({
  page,
  request,
}) => {
  const projectId = await createStudioProject(page, 'Playwright arrangement workspace session')
  await seedGuideAndTake(page, request, projectId)
  await runChordAwareAnalysis(page)
  await extractMelodyDraft(page)
  await generateArrangementCandidates(page)

  await page.goto(`/projects/${projectId}/arrangement`)

  await expect(page.getByRole('heading', { name: '후보를 바꿔 듣고 악보 기준으로 바로 고르세요' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '후보와 제약' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /악보 미리듣기$/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: '파트 집중과 내보내기' })).toBeVisible()
  await expect(page.getByRole('button', { name: /A ·/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '미리듣기 재생' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'MusicXML 내보내기' })).toBeVisible()
  await expect(page.getByRole('link', { name: '편곡 MIDI 내보내기' })).toBeVisible()
  await expect(page.getByRole('link', { name: '스튜디오에서 자세히 수정하기' })).toBeVisible()
})

test('release gate recording flow captures a take through browser microphone transport', async ({
  page,
  request,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Fake microphone transport is currently Chromium-only.')

  const projectId = await createStudioProject(page, 'Playwright recording gate session')
  await seedGuideOnly(page, request, projectId)
  await prepareBrowserRecording(page)

  const recorderPanel = getRecorderPanel(page)
  await expect(recorderPanel.getByText('테이크 수', { exact: true })).toBeVisible()
  await expect(recorderPanel.getByText('아직 테이크가 없습니다.', { exact: true })).toBeVisible()

  await recordBrowserTake(page, 1)
  await expect(recorderPanel.getByText('가장 최근 준비 완료 테이크', { exact: true })).toBeVisible()
  const waveformPreview = page.locator('.waveform-preview').first()
  await expect(waveformPreview.getByTestId('waveform-preview-pipeline')).toBeVisible()
  await expect(waveformPreview.getByText('브라우저 빠른 계산', { exact: true })).toBeVisible()
})

test('release gate arrangement playback shows transport progress and can be stopped cleanly', async ({
  page,
  request,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'Playwright WebKit on Windows does not expose Web Audio playback yet.')

  const projectId = await createStudioProject(page, 'Playwright playback gate session')
  await seedGuideAndTake(page, request, projectId)
  await runChordAwareAnalysis(page)
  await extractMelodyDraft(page)
  await generateArrangementCandidates(page)

  const playbackPanel = getPlaybackPanel(page)
  const progressFill = playbackPanel.locator('.transport-progress__fill')
  const stopButton = playbackPanel.getByRole('button', { name: '재생 중지' })
  const guideModeCheckbox = playbackPanel.getByLabel('가이드 겹치기')

  await expect(playbackPanel.getByText('편곡 미리듣기를 시작할 수 있습니다.', { exact: true })).toBeVisible()
  await expect(stopButton).toBeDisabled()

  await guideModeCheckbox.check()
  await expect(guideModeCheckbox).toBeChecked()

  await playbackPanel.getByRole('button', { name: '편곡 미리듣기 재생' }).click()
  await expect(stopButton).toBeEnabled()

  await expect
    .poll(
      async () => {
        const style = await progressFill.getAttribute('style')
        return style ?? ''
      },
      { timeout: 5000 },
    )
    .not.toContain('width: 0%')

  await stopButton.click()
  await expect(playbackPanel.getByText('편곡 미리듣기를 시작할 수 있습니다.', { exact: true })).toBeVisible()
  await expect(
    playbackPanel.getByText('편곡 미리듣기를 시작할 수 있습니다.', { exact: true }),
  ).toBeVisible()
})

test('release gate ops overview can export the environment diagnostics report', async ({
  page,
  request,
  browserName,
}) => {
  await saveDeviceProfileFixture(request, `diagnostics-${browserName}`)

  await page.goto('/ops')
  await expect(page.getByRole('heading', { name: '운영 개요와 릴리즈 게이트' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '브라우저 오디오 편차를 지원 이슈가 되기 전에 추적합니다' })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '환경 리포트 내려받기' }).click()
  await expect(
    page.getByText(
      '환경 진단 리포트를 내려받았습니다. 실기기 하드웨어 검증의 기준선으로 사용하세요.',
      { exact: true },
    ),
  ).toBeVisible()

  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^gigastudy-environment-diagnostics-\d{4}-\d{2}-\d{2}\.json$/)

  const downloadPath = await download.path()
  expect(downloadPath).toBeTruthy()
  const reportText = await readFile(downloadPath!, 'utf8')
  const report = JSON.parse(reportText) as {
    exported_at: string
    environment_diagnostics: {
      recent_profiles: Array<{
        browser: string
        warning_flags: string[]
      }>
      warning_flags: Array<{
        flag: string
      }>
    }
  }

  expect(report.exported_at).toBeTruthy()
  expect(
    report.environment_diagnostics.recent_profiles.some(
      (profile) =>
        profile.browser === 'Safari' &&
        profile.warning_flags.includes('missing_offline_audio_context'),
    ),
  ).toBeTruthy()
  expect(
    report.environment_diagnostics.warning_flags.some(
      (warning) => warning.flag === 'legacy_webkit_audio_context_only',
    ),
  ).toBeTruthy()
})

test('release gate ops overview can export the environment validation packet', async ({
  page,
  request,
  browserName,
}) => {
  await saveDeviceProfileFixture(request, `packet-${browserName}`)
  await saveValidationRunFixture(request)

  await page.goto('/ops')
  await expect(page.getByRole('heading', { name: '운영 개요와 릴리즈 게이트' })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '검증 패킷 내려받기' }).click()
  await expect(
    page.getByText(
      '환경 검증 패킷을 내려받았습니다. 릴리즈 노트, 호환성 메모, 실기기 브라우저 증거 검토에 사용하세요.',
      { exact: true },
    ),
  ).toBeVisible()

  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^gigastudy-environment-validation-packet-\d{4}-\d{2}-\d{2}\.json$/)

  const downloadPath = await download.path()
  expect(downloadPath).toBeTruthy()
  const reportText = await readFile(downloadPath!, 'utf8')
  const packet = JSON.parse(reportText) as {
    generated_from: string
    summary: {
      total_validation_runs: number
      native_safari_run_count: number
    }
    required_matrix: Array<{
      label: string
      covered: boolean
    }>
    compatibility_notes: string[]
  }

  expect(packet.generated_from).toBe('ops_environment_validation_packet')
  expect(packet.summary.total_validation_runs).toBeGreaterThanOrEqual(1)
  expect(packet.summary.native_safari_run_count).toBeGreaterThanOrEqual(1)
  expect(
    packet.required_matrix.some(
      (item) => item.label === 'macOS + Safari + Bluetooth output' && item.covered,
    ),
  ).toBeTruthy()
  expect(
    packet.compatibility_notes.some((item) => item.includes('legacy WebKit audio contexts')),
  ).toBeTruthy()
})

test('release gate ops overview can export browser compatibility release notes', async ({
  page,
  request,
  browserName,
}) => {
  await saveDeviceProfileFixture(request, `notes-${browserName}`)
  await saveValidationRunFixture(request)

  await page.goto('/ops')
  await expect(page.getByRole('heading', { name: '운영 개요와 릴리즈 게이트' })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '호환성 노트 내려받기' }).click()
  await expect(
    page.getByText(
      '브라우저 호환성 릴리즈 노트 초안을 내려받았습니다. 지원 문구를 공개하기 전에 미검증 경로를 먼저 확인하세요.',
      { exact: true },
    ),
  ).toBeVisible()

  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^gigastudy-browser-compatibility-notes-\d{4}-\d{2}-\d{2}\.md$/)

  const downloadPath = await download.path()
  expect(downloadPath).toBeTruthy()
  const markdown = await readFile(downloadPath!, 'utf8')

  expect(markdown).toContain('# Browser Environment Release Notes Draft')
  expect(markdown).toContain('## Compatibility Notes')
  expect(markdown).toContain('## Unsupported Or Not Yet Validated Paths')
  expect(markdown).toContain('실기기 Safari 기준 실행')
})

test('release gate ops overview can export the browser environment claim gate', async ({
  page,
  request,
  browserName,
}) => {
  await saveDeviceProfileFixture(request, `claim-${browserName}`)
  await saveValidationRunFixture(request)

  await page.goto('/ops')
  await expect(page.getByRole('heading', { name: '운영 개요와 릴리즈 게이트' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '클레임 게이트' })).toBeVisible()
  await expect(
    page.getByText(
      '실기기 브라우저와 하드웨어 증거가 체크리스트 종료 검토를 시작할 만큼 충분한지 확인합니다.',
      { exact: true },
    ),
  ).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('download-claim-gate-button').click()
  await expect(
    page.getByText(/브라우저 환경 클레임 게이트를 내려받았습니다\./),
  ).toBeVisible()

  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^gigastudy-browser-environment-claim-gate-\d{4}-\d{2}-\d{2}\.md$/)

  const downloadPath = await download.path()
  expect(downloadPath).toBeTruthy()
  const markdown = await readFile(downloadPath!, 'utf8')

  expect(markdown).toContain('# Browser Environment Claim Gate')
  expect(markdown).toContain('Release claim ready:')
  expect(markdown).toContain('native_safari_run_count')
})

test('release gate ops overview can store a manual environment validation run', async ({
  page,
  request,
}) => {
  await page.goto('/ops')
  await expect(page.getByRole('heading', { name: '실기기 브라우저 또는 하드웨어 검증 실행을 기록합니다' })).toBeVisible()

  await page.getByLabel('실행 이름').fill('실기기 Safari 수동 점검')
  await page.getByLabel('테스터').fill('브라우저 QA')
  await page.getByLabel('기기 이름').fill('MacBook Pro 14')
  await page.getByLabel('운영체제').fill('macOS 15.4')
  await page.getByLabel('브라우저', { exact: true }).fill('Safari 18')
  await page.getByLabel('입력 장치').fill('Built-in Microphone')
  await page.getByLabel('출력 경로').fill('Built-in Speakers')
  await page.getByLabel('경고 플래그').fill(
    'legacy_webkit_audio_context_only, missing_offline_audio_context',
  )
  await page.getByLabel('레코더 MIME').fill('audio/mp4')
  await page.getByLabel('기본 재생 경로').fill('webkit')
  await page.getByLabel('합치기 미리듣기 경로').fill('unavailable')
  await page.getByLabel('샘플레이트 (Hz)').fill('48000')
  await page.getByLabel('기본 지연 (ms)').fill('17')
  await page.getByLabel('출력 지연 (ms)').fill('39')
  await page.getByLabel('재생 성공').uncheck()
  await page.getByLabel('후속 작업').fill(
    'Safari 재생 대체 경로를 실기기에서 다시 확인합니다.',
  )
  await page.getByLabel('메모').fill(
    '녹음 경로는 통과했지만 재생은 이 환경에서 제한되었습니다.',
  )

  await page.getByRole('button', { name: '검증 실행 저장' }).click()
  await expect(
    page.getByText(
      '환경 검증 실행 기록을 저장했습니다. 운영 개요에 최신 수동 브라우저 점검이 반영되었습니다.',
      { exact: true },
    ),
  ).toBeVisible()

  const validationRunsResponse = await request.get(`${apiBaseUrl}/api/admin/environment-validations`)
  expect(validationRunsResponse.ok()).toBeTruthy()
  const validationRunsPayload = (await validationRunsResponse.json()) as {
    items: Array<{
      label: string
      tester: string | null
      outcome: 'PASS' | 'WARN' | 'FAIL'
      follow_up: string | null
    }>
  }

  expect(
    validationRunsPayload.items.some(
      (item) =>
        item.label === '실기기 Safari 수동 점검' &&
        item.tester === '브라우저 QA' &&
        item.outcome === 'WARN' &&
        item.follow_up === 'Safari 재생 대체 경로를 실기기에서 다시 확인합니다.',
    ),
  ).toBeTruthy()
})

test('release gate ops overview can download an environment validation starter pack', async ({
  page,
}) => {
  await page.goto('/ops')
  const importPanel = page.getByTestId('validation-import-panel')
  await expect(importPanel).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await importPanel.getByTestId('download-validation-template-button').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('gigastudy-environment-validation-starter-pack.zip')
  const downloadPath = await download.path()
  expect(downloadPath).toBeTruthy()
})

test('release gate ops overview can preview and import validation CSV intake', async ({
  page,
  request,
}) => {
  const csvText = [
    'label,tester,device_name,os,browser,input_device,output_route,outcome,secure_context,microphone_permission_before,microphone_permission_after,recording_mime_type,audio_context_mode,offline_audio_context_mode,actual_sample_rate,base_latency_ms,output_latency_ms,warning_flags,take_recording_succeeded,analysis_succeeded,playback_succeeded,audible_issues,permission_issues,unexpected_warnings,follow_up,notes,validated_at',
    '가져온 Safari CSV 실행,QA 리드,MacBook Pro 14,macOS 15.4,Safari 18,Built-in Microphone,AirPods Bluetooth,WARN,TRUE,prompt,granted,,webkit,unavailable,48000,18,41,"legacy_webkit_audio_context_only, missing_offline_audio_context",TRUE,TRUE,FALSE,재생 저하,권한 재확인 필요,missing_offline_audio_context,Safari 재생 재확인,시트에서 가져온 기록,2026-04-09T12:10:00Z',
    '가져온 Chrome CSV 실행,QA 리드,USB rig,Windows 11,Chrome 136,USB microphone,Wired headphones,PASS,TRUE,prompt,granted,audio/webm,standard,standard,48000,12,21,,TRUE,TRUE,TRUE,,,,,2026-04-09T12:20:00Z',
  ].join('\n')

  await page.goto('/ops')
  const importPanel = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: '외부 검증 시트를 미리 보고 가져옵니다' }) })
    .first()
  await expect(importPanel).toBeVisible()

  await importPanel.getByRole('textbox', { name: '환경 검증 CSV' }).fill(csvText)
  await importPanel.getByRole('button', { name: '가져오기 미리보기' }).click()
  await expect(
    page.getByText('검증 실행 2건의 미리보기를 준비했습니다. 가져오기 전에 행을 확인해 주세요.', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(importPanel.getByText('가져온 Safari CSV 실행', { exact: true }).first()).toBeVisible()
  await expect(importPanel.getByText('가져온 Chrome CSV 실행', { exact: true }).first()).toBeVisible()

  await importPanel.getByRole('button', { name: '미리 본 실행 가져오기' }).click()
  await expect(
    page.getByText('외부 CSV에서 검증 실행 2건을 ops로 가져왔습니다.', {
      exact: true,
    }),
  ).toBeVisible()

  const validationRunsResponse = await request.get(`${apiBaseUrl}/api/admin/environment-validations`)
  expect(validationRunsResponse.ok()).toBeTruthy()
  const validationRunsPayload = (await validationRunsResponse.json()) as {
    items: Array<{ label: string }>
  }

  expect(validationRunsPayload.items.some((item) => item.label === '가져온 Safari CSV 실행')).toBeTruthy()
  expect(validationRunsPayload.items.some((item) => item.label === '가져온 Chrome CSV 실행')).toBeTruthy()
})

test('release gate long-session stability survives repeated take and analysis cycles', async ({
  page,
  request,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Session endurance currently depends on Chromium fake-mic transport.')

  const pageErrors: string[] = []
  page.on('pageerror', (error) => {
    pageErrors.push(error.message)
  })

  const projectId = await createStudioProject(page, 'Playwright endurance gate session')
  await seedGuideOnly(page, request, projectId)
  await prepareBrowserRecording(page)

  const recorderPanel = getRecorderPanel(page)
  await recordBrowserTake(page, 1)
  await recordBrowserTake(page, 2)

  await expect(getTakeCard(page, 1)).toBeVisible()
  await expect(getTakeCard(page, 2)).toBeVisible()
  await expect(recorderPanel.getByRole('heading', { name: '1번 테이크' })).toBeVisible()
  await expect(recorderPanel.getByRole('heading', { name: '2번 테이크' })).toBeVisible()

  await getTakeCard(page, 1).getByRole('button', { name: '선택' }).click()
  await page.getByTestId('run-post-analysis-button').click()
  await expect(page.getByText(/분석을 저장했습니다\./)).toBeVisible()

  await getTakeCard(page, 2).getByRole('button', { name: '선택' }).click()
  await page.getByTestId('run-post-analysis-button').click()
  await expect(page.getByText(/분석을 저장했습니다\./)).toBeVisible()

  await extractMelodyDraft(page)
  await generateArrangementCandidates(page)

  const playbackPanel = getPlaybackPanel(page)
  const progressFill = playbackPanel.locator('.transport-progress__fill')
  const stopButton = playbackPanel.getByRole('button', { name: '재생 중지' })
  await playbackPanel.getByRole('button', { name: '편곡 미리듣기 재생' }).click()
  await expect
    .poll(
      async () => {
        const style = await progressFill.getAttribute('style')
        return style ?? ''
      },
      { timeout: 10000 },
    )
    .not.toContain('width: 0%')

  if (await stopButton.isEnabled()) {
    await stopButton.click()
  }
  await expect(playbackPanel.getByText('편곡 미리듣기를 시작할 수 있습니다.', { exact: true })).toBeVisible()

  const shareLinksPanel = getShareLinksPanel(page)
  await shareLinksPanel.getByLabel('공유 이름').fill('Session endurance review')
  await page.getByRole('button', { name: '읽기 전용 공유 링크 만들기' }).click()
  await expect(page.getByText(/"Session endurance review" 읽기 전용 공유 링크를 만들었고/)).toBeVisible()
  await expect(
    shareLinksPanel.locator('article.history-card').filter({ hasText: 'Session endurance review' }).first(),
  ).toBeVisible()

  expect(pageErrors).toEqual([])
})
