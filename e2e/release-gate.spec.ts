import { expect, test, type Page } from '@playwright/test'

const sopranoMusicXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Soprano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>G</step><octave>5</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>
`

async function createBlankStudio(page: Page, title: string, bpm = '120') {
  await page.goto('/')
  await page.getByTestId('studio-title-input').fill(title)
  await page.getByTestId('studio-bpm-input').fill(bpm)
  await page.getByTestId('start-blank-button').click()
  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+$/)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByText('트랙 편집')).toBeVisible()
  await expect(page.getByRole('link', { exact: true, name: '파일' })).toBeVisible()
  await expect(page.getByRole('button', { exact: true, name: '트랙' })).toBeDisabled()
  await expect(page.locator('.composer-tool--home')).toHaveText('홈')
  await expect(page.getByTestId('playback-source-audio')).toHaveText('원음 우선')
  await expect(page.getByTestId('playback-source-events')).toHaveText('연주음만')
  await expect(page.getByTestId('track-card-1')).toBeVisible()
}

async function uploadSopranoMusicXml(page: Page, slotId = 1) {
  await page.locator(`[data-testid="track-card-${slotId}"] input[type="file"]`).setInputFiles({
    name: 'soprano.musicxml',
    mimeType: 'application/vnd.recordare.musicxml+xml',
    buffer: Buffer.from(sopranoMusicXml, 'utf-8'),
  })
  await expect(page.getByTestId('candidate-review')).toContainText('소프라노')
}

async function approveFirstCandidate(page: Page) {
  await page.locator('[data-testid^="candidate-approve-"]').first().click()
  await expect(page.getByTestId('candidate-review')).toBeHidden()
}

async function expectRegisteredRegion(page: Page, slotId: number, labels: string[]) {
  const region = page.getByTestId(`track-region-${slotId}`)
  await expect(region).toBeVisible()
  await expect(region).toContainText(`${labels.length}개 음표`)
  await region.click()
  for (const label of labels) {
    await expect(page.locator('.piano-roll__event', { hasText: label })).toBeVisible()
  }
}

test('blank studio opens the region editor and independent practice route', async ({ page }) => {
  await createBlankStudio(page, 'Region blank session')

  await page.getByTestId('practice-mode-link').click()

  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+\/practice$/)
  await expect(page.getByText('GigaStudy 연습 - Region blank session')).toBeVisible()
  await expect(page.getByTestId('practice-stop-button')).toBeDisabled()
  await expect(page.getByRole('button', { name: '원음 우선' })).toBeVisible()
  await expect(page.getByRole('button', { name: '연주음만' })).toBeVisible()
  await expect(page.getByTestId('practice-waterfall-stage')).toBeVisible()
  await expect(page.getByText('등록된 트랙이 아직 없습니다.')).toBeVisible()
  await expect(page.getByText('등록된 음표가 아직 없습니다.')).toBeVisible()
})

test('document upload becomes a region, piano-roll events, and practice waterfall notes', async ({ page }) => {
  await createBlankStudio(page, 'Region import session', '104')
  await uploadSopranoMusicXml(page)
  await expect(page.locator('[data-testid^="candidate-region-"]').first()).toContainText('C5')
  await approveFirstCandidate(page)

  await expectRegisteredRegion(page, 1, ['C5', 'G5'])
  const c5EventTestId = await page.locator('.piano-roll__event', { hasText: 'C5' }).first().getAttribute('data-testid')
  if (!c5EventTestId) {
    throw new Error('Expected imported piano-roll event to expose a stable test id')
  }
  const c5EventId = c5EventTestId.replace('piano-event-', '')
  await page.goto(`${page.url()}?region=track-1-region-1&event=${encodeURIComponent(c5EventId)}`)
  await expect(page.getByTestId('track-region-1')).toHaveClass(/is-focused/)
  await expect(page.getByTestId(c5EventTestId)).toHaveClass(/is-focused/)

  await page.getByTestId('practice-mode-link').click()
  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+\/practice$/)
  await expect(page.getByTestId('practice-track-checkbox-1')).toBeChecked()
  await expect(page.getByTestId('practice-waterfall-stage')).toContainText('소프라노')
  await expect(page.getByTestId('practice-waterfall-stage').locator('text=C5')).toBeVisible()
  await expect(page.getByTestId('practice-waterfall-stage').locator('text=G5')).toBeVisible()
})

test('AI generation registers a second editable region', async ({ page }) => {
  await createBlankStudio(page, 'Region AI session')
  await uploadSopranoMusicXml(page)
  await approveFirstCandidate(page)

  await expect(page.getByTestId('track-generate-2')).toBeEnabled()
  await page.getByTestId('track-generate-2').click()
  await expect(page.getByTestId('candidate-review')).toContainText('후보')
  await expect(page.locator('[data-testid^="candidate-region-"]').first()).toContainText('E4')
  await approveFirstCandidate(page)

  await expectRegisteredRegion(page, 2, ['E4', 'G4'])
  await expect(page.locator('.studio-tracks__summary')).toContainText('등록 2')
})
