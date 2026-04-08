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
}) => {
  const projectId = await createStudioProject(page, 'Playwright recording gate session')
  await seedGuideOnly(page, request, projectId)

  await page.getByRole('button', { name: 'Request microphone access' }).click()
  await expect(page.getByText(/Microphone access granted\./)).toBeVisible()

  await page.getByRole('button', { name: 'Save DeviceProfile' }).click()
  await expect(page.getByText(/DeviceProfile saved with requested constraints and applied settings\./)).toBeVisible()

  await page.getByLabel('Count-in length').selectOption('0')
  await page.getByLabel('Metronome during recording').uncheck()

  const recorderPanel = getRecorderPanel(page)
  await expect(recorderPanel.getByText('Take count', { exact: true })).toBeVisible()
  await expect(recorderPanel.getByText('No takes yet.', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Start take' }).click()
  await expect(page.getByText('Recording in progress. Stop when the take is done.', { exact: true })).toBeVisible()
  await page.waitForTimeout(1400)
  await page.getByRole('button', { name: 'Stop take' }).click()

  await expect(page.getByText(/Take 1 uploaded and ready\./)).toBeVisible({ timeout: 20000 })
  await expect(page.getByRole('heading', { name: 'Take 1' })).toBeVisible()
  await expect(recorderPanel.getByText('Latest ready take', { exact: true })).toBeVisible()
})
