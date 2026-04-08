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

async function saveDeviceProfileFixture(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${apiBaseUrl}/api/device-profiles`, {
    data: {
      browser: 'Safari',
      os: 'macOS',
      input_device_hash: 'fixture-mic',
      output_route: 'bluetooth-output',
      browser_user_agent: 'Playwright Safari fixture',
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

async function createStudioProject(page: Page, title: string): Promise<string> {
  await page.goto('/')
  await page.getByLabel('Project title').fill(title)
  await page.getByLabel('Base key').fill('A')
  await page.getByRole('button', { name: 'Open studio' }).click()
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
  await expect(page.getByRole('heading', { name: 'Take 1' })).toBeVisible()
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
  await page.getByRole('button', { name: 'Request microphone access' }).click()
  await expect(page.getByText(/Microphone access granted\./)).toBeVisible()

  await page.getByRole('button', { name: 'Save DeviceProfile' }).click()
  await expect(page.getByText(/DeviceProfile saved with requested constraints and applied settings\./)).toBeVisible()

  await page.getByLabel('Count-in length').selectOption('0')
  await page.getByLabel('Metronome during recording').uncheck()
}

async function recordBrowserTake(page: Page, takeNumber: number): Promise<void> {
  await page.getByRole('button', { name: 'Start take' }).click()
  await expect(page.getByText('Recording in progress. Stop when the take is done.', { exact: true })).toBeVisible()
  await page.waitForTimeout(1400)
  await page.getByRole('button', { name: 'Stop take' }).click()
  await expect(page.getByText(new RegExp(`Take ${takeNumber} uploaded and ready\\.`))).toBeVisible({
    timeout: 20000,
  })
  await expect(page.getByRole('heading', { name: `Take ${takeNumber}` })).toBeVisible()
}

async function runChordAwareAnalysis(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Seed from current key' }).click()
  await page.getByRole('button', { name: 'Save chord timeline' }).click()
  await expect(page.getByText(/Saved 1 chord marker/)).toBeVisible()

  await page.getByRole('button', { name: 'Run post-recording analysis' }).click()
  await expect(page.getByText(/Analysis saved\./)).toBeVisible()
}

async function extractMelodyDraft(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Extract melody draft' }).click()
  await expect(page.getByText(/Melody draft saved with/i)).toBeVisible()
}

async function generateArrangementCandidates(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Generate arrangement candidates' }).click()
  await expect(page.getByText(/arrangement candidates are ready for comparison\./i)).toBeVisible()
}

function getNoteFeedbackPanel(page: Page) {
  return page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'See which note was sharp, flat, late, or unstable' }) })
}

function getShareLinksPanel(page: Page) {
  return page
    .locator('article')
    .filter({
      has: page.getByRole('heading', {
        name: 'Create read-only share URLs tied to a frozen snapshot',
      }),
    })
}

function getArrangementEnginePanel(page: Page) {
  return page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Generate candidate A/B/C from the latest melody draft' }) })
}

function getScoreViewPanel(page: Page) {
  return page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Render the selected candidate as MusicXML' }) })
}

function getRecorderPanel(page: Page) {
  return page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Capture repeated takes and upload them with status' }) })
}

function getPlaybackPanel(page: Page) {
  return page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Preview parts with guide mode and synchronized transport' }) })
}

function getTakeCard(page: Page, takeNumber: number) {
  return page
    .locator('article.take-card')
    .filter({ has: page.getByRole('heading', { name: `Take ${takeNumber}` }) })
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
  await expect(noteFeedbackPanel.getByText('Chord-aware harmony', { exact: true })).toBeVisible()
  await expect(noteFeedbackPanel.getByText('Pitch mode', { exact: true })).toBeVisible()
  await expect(noteFeedbackPanel.getByRole('button', { name: 'N1' })).toBeVisible()
  await expect(noteFeedbackPanel.getByRole('heading', { name: /Note 1/i })).toBeVisible()
})

test('release gate share flow opens a frozen snapshot and loses access after deactivation', async ({
  page,
  request,
}) => {
  const projectId = await createStudioProject(page, 'Playwright share gate session')
  await seedGuideAndTake(page, request, projectId)
  await runChordAwareAnalysis(page)

  const shareLinksPanel = getShareLinksPanel(page)
  await shareLinksPanel.getByLabel('Share label').fill('Coach review')
  await page.getByRole('button', { name: 'Create read-only share link' }).click()
  await expect(page.getByText(/Created read-only share link "Coach review"/)).toBeVisible()

  const shareCard = shareLinksPanel.locator('article.history-card').filter({ hasText: 'Coach review' }).first()
  await expect(shareCard).toBeVisible()

  const popupPromise = page.waitForEvent('popup')
  await shareCard.getByRole('link', { name: 'Open share view' }).click()
  const sharePage = await popupPromise
  await sharePage.waitForLoadState('domcontentloaded')

  await expect(sharePage).toHaveURL(/\/shared\//)
  await expect(sharePage.getByRole('heading', { name: 'Playwright share gate session' })).toBeVisible()
  await expect(sharePage.getByText('Read-Only Share', { exact: true })).toBeVisible()
  await expect(sharePage.getByRole('heading', { name: 'Frozen review snapshot' })).toBeVisible()
  await expect(sharePage.getByRole('heading', { name: 'Recorded take results' })).toBeVisible()
  await expect(sharePage.getByText('Coach review', { exact: true })).toBeVisible()
  await expect(sharePage.getByText('Take 1', { exact: false })).toBeVisible()
  await expect(sharePage.getByRole('button', { name: 'Run post-recording analysis' })).toHaveCount(0)
  await expect(sharePage.getByRole('button', { name: 'Create read-only share link' })).toHaveCount(0)

  await shareCard.getByRole('button', { name: 'Deactivate' }).click()
  await expect(page.getByText(/Deactivated "Coach review"/)).toBeVisible()

  await sharePage.reload()
  await expect(sharePage.getByRole('heading', { name: 'Shared project unavailable' })).toBeVisible()
  await expect(sharePage.getByText('Share link is inactive')).toBeVisible()
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
  await expect(arrangementEnginePanel.getByText(/3 candidates/i)).toBeVisible()
  await expect(arrangementEnginePanel.getByText(/A \/ B \/ C compare/i)).toBeVisible()
  await expect(arrangementEnginePanel.locator('article.candidate-card')).toHaveCount(3)
  await expect(arrangementEnginePanel.getByRole('link', { name: 'Download arrangement MIDI' }).first()).toBeVisible()

  const scoreViewPanel = getScoreViewPanel(page)
  await expect(scoreViewPanel.getByText('MusicXML ready', { exact: true })).toBeVisible()

  const musicXmlLink = scoreViewPanel.getByRole('link', { name: 'Export MusicXML' })
  const arrangementMidiLink = scoreViewPanel.getByRole('link', { name: 'Export arrangement MIDI' })
  const guideWavLink = scoreViewPanel.getByRole('link', { name: 'Export guide WAV' })

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
    request.get(musicXmlHref!),
    request.get(arrangementMidiHref!),
    request.get(guideWavHref!),
  ])

  expect(musicXmlResponse.ok()).toBeTruthy()
  expect(arrangementMidiResponse.ok()).toBeTruthy()
  expect(guideWavResponse.ok()).toBeTruthy()

  expect((await musicXmlResponse.text()).includes('<score-partwise')).toBeTruthy()
  expect((await arrangementMidiResponse.body()).byteLength).toBeGreaterThan(32)
  expect((await guideWavResponse.body()).byteLength).toBeGreaterThan(32)
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
  await expect(recorderPanel.getByText('Take count', { exact: true })).toBeVisible()
  await expect(recorderPanel.getByText('No takes yet.', { exact: true })).toBeVisible()

  await recordBrowserTake(page, 1)
  await expect(recorderPanel.getByText('Latest ready take', { exact: true })).toBeVisible()
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
  const stopButton = playbackPanel.getByRole('button', { name: 'Stop playback' })
  const guideModeCheckbox = playbackPanel.getByLabel('Guide mode')

  await expect(playbackPanel.getByText('Playback ready', { exact: true })).toBeVisible()
  await expect(stopButton).toBeDisabled()

  await guideModeCheckbox.check()
  await expect(guideModeCheckbox).toBeChecked()

  await playbackPanel.getByRole('button', { name: 'Play arrangement preview' }).click()
  await expect(playbackPanel.getByText('Playing', { exact: true })).toBeVisible()
  await expect(
    playbackPanel.getByText(
      'Playback is running through the separate arrangement preview engine.',
      { exact: true },
    ),
  ).toBeVisible()
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
  await expect(playbackPanel.getByText('Playback ready', { exact: true })).toBeVisible()
  await expect(
    playbackPanel.getByText('Arrangement playback is ready.', { exact: true }),
  ).toBeVisible()
})

test('release gate ops overview can export the environment diagnostics report', async ({
  page,
  request,
}) => {
  await saveDeviceProfileFixture(request)

  await page.goto('/ops')
  await expect(page.getByRole('heading', { name: 'Operations overview and release gate' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Track browser audio variability before it becomes a support mystery' })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download environment report' }).click()
  await expect(
    page.getByText(
      'Environment diagnostics report downloaded. Use it as the baseline for native hardware validation.',
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
  await expect(recorderPanel.getByRole('heading', { name: 'Take 1' })).toBeVisible()
  await expect(recorderPanel.getByRole('heading', { name: 'Take 2' })).toBeVisible()

  await getTakeCard(page, 1).getByRole('button', { name: 'Select' }).click()
  await page.getByRole('button', { name: 'Run post-recording analysis' }).click()
  await expect(page.getByText(/Analysis saved\./)).toBeVisible()

  await getTakeCard(page, 2).getByRole('button', { name: 'Select' }).click()
  await page.getByRole('button', { name: 'Run post-recording analysis' }).click()
  await expect(page.getByText(/Analysis saved\./)).toBeVisible()

  await extractMelodyDraft(page)
  await generateArrangementCandidates(page)

  const playbackPanel = getPlaybackPanel(page)
  await playbackPanel.getByRole('button', { name: 'Play arrangement preview' }).click()
  await expect(playbackPanel.getByText('Playing', { exact: true })).toBeVisible()
  await playbackPanel.getByRole('button', { name: 'Stop playback' }).click()
  await expect(playbackPanel.getByText('Playback ready', { exact: true })).toBeVisible()

  const shareLinksPanel = getShareLinksPanel(page)
  await shareLinksPanel.getByLabel('Share label').fill('Session endurance review')
  await page.getByRole('button', { name: 'Create read-only share link' }).click()
  await expect(page.getByText(/Created read-only share link "Session endurance review"/)).toBeVisible()
  await expect(
    shareLinksPanel.locator('article.history-card').filter({ hasText: 'Session endurance review' }).first(),
  ).toBeVisible()

  expect(pageErrors).toEqual([])
})
