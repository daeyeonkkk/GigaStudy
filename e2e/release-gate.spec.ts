import { expect, test, type APIRequestContext } from '@playwright/test'

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

test('release gate smoke path reaches chord-aware note feedback through the studio', async ({
  page,
  request,
}) => {
  const guideBuffer = buildMonoWavBuffer({ frequencyHz: 440 })
  const takeBuffer = buildMonoWavBuffer({ frequencyHz: 440 })

  await page.goto('/')
  await page.getByLabel('Project title').fill('Playwright release gate session')
  await page.getByLabel('Base key').fill('A')
  await page.getByRole('button', { name: 'Open studio' }).click()
  await expect(page).toHaveURL(/\/projects\/[^/]+\/studio$/)

  const projectIdMatch = page.url().match(/\/projects\/([^/]+)\/studio$/)
  expect(projectIdMatch).not.toBeNull()
  const projectId = projectIdMatch?.[1]
  if (!projectId) {
    throw new Error('Expected project id in studio URL.')
  }

  await uploadGuide(request, projectId, guideBuffer)
  await uploadTake(request, projectId, takeBuffer)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Take 1' })).toBeVisible()

  await page.getByRole('button', { name: 'Seed from current key' }).click()
  await page.getByRole('button', { name: 'Save chord timeline' }).click()
  await expect(page.getByText(/Saved 1 chord marker/)).toBeVisible()

  await page.getByRole('button', { name: 'Run post-recording analysis' }).click()
  await expect(page.getByText(/Analysis saved\./)).toBeVisible()

  const noteFeedbackPanel = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'See which note was sharp, flat, late, or unstable' }) })

  await expect(noteFeedbackPanel.getByText('Chord-aware harmony', { exact: true })).toBeVisible()
  await expect(noteFeedbackPanel.getByText('Pitch mode', { exact: true })).toBeVisible()
  await expect(noteFeedbackPanel.getByRole('button', { name: 'N1' })).toBeVisible()
  await expect(noteFeedbackPanel.getByRole('heading', { name: /Note 1/i })).toBeVisible()
})
