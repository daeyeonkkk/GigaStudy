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

const studioPassword = 'release-gate-password'

async function createBlankStudio(page: Page, title: string, bpm = '120') {
  await page.goto('/')
  await page.getByTestId('studio-title-input').fill(title)
  await page.getByTestId('studio-password-input').fill(studioPassword)
  await page.getByTestId('studio-bpm-input').fill(bpm)
  await page.getByTestId('start-blank-button').click()
  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+$/)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByTestId('purpose-nav-studio')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('purpose-nav-editor')).toBeVisible()
  await expect(page.getByTestId('purpose-nav-practice')).toBeVisible()
  await expect(page.getByTestId('playback-source-audio')).toHaveText('원음 우선')
  await expect(page.getByTestId('playback-source-events')).toHaveText('연주음만')
  await expect(page.getByTestId('track-card-1')).toBeVisible()
  await expect(page.locator('[data-testid="track-card-1"] input[type="file"]')).toHaveAttribute(
    'accept',
    '.wav,.mp3,.m4a,.ogg,.flac',
  )
  await expect(page.locator('[data-testid^="track-score-"]')).toHaveCount(0)
}

async function createStudioFromSopranoMusicXml(page: Page, title: string) {
  await page.goto('/')
  await page.getByTestId('studio-title-input').fill(title)
  await page.getByTestId('studio-password-input').fill(studioPassword)
  await page.getByTestId('studio-source-input').setInputFiles({
    name: 'soprano.musicxml',
    mimeType: 'application/vnd.recordare.musicxml+xml',
    buffer: Buffer.from(sopranoMusicXml, 'utf-8'),
  })
  await page.getByTestId('upload-and-start-button').click()
  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+$/)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByTestId('purpose-nav-studio')).toHaveAttribute('aria-current', 'page')
  await expectRegisteredRegion(page, 1, ['C5', 'G5'])
}

async function approveFirstCandidate(page: Page) {
  await page.locator('[data-testid^="candidate-approve-"]').first().click()
  await expect(page.getByTestId('candidate-review')).toBeHidden()
}

async function expectRegisteredRegion(page: Page, slotId: number, labels: string[]) {
  const region = page.getByTestId(`track-region-${slotId}`)
  await expect(region).toBeVisible()
  await expect(page.locator(`[data-track-slot-id="${slotId}"][data-testid^="track-event-mini-"]`)).toHaveCount(labels.length)
  for (const label of labels) {
    await expect(page.locator(`[data-track-slot-id="${slotId}"][title*="${label}"]`).first()).toBeVisible()
  }
}

async function openNoteEditorForRegion(page: Page, slotId: number, labels: string[]) {
  const region = page.getByTestId(`track-region-${slotId}`)
  await region.click()
  await page.getByTestId('open-note-editor-button').click()
  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+\/edit\?/)
  for (const label of labels) {
    await expect(page.locator(`.piano-roll__event[title*="${label}"]`)).toBeVisible()
  }
}

test('blank studio opens the region editor and independent practice route', async ({ page }) => {
  await createBlankStudio(page, 'Region blank session')

  await page.getByTestId('purpose-nav-editor').click()
  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+\/edit$/)
  await expect(page.getByText('GigaStudy 구간 편집 - Region blank session')).toBeVisible()
  await expect(page.getByTestId('purpose-nav-editor')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.piano-roll-panel')).toBeVisible()
  await expect(page.getByText('편집할 구간을 선택하세요.')).toBeVisible()

  await page.getByTestId('purpose-nav-practice').click()

  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+\/practice$/)
  await expect(page.getByTestId('purpose-nav-practice')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('GigaStudy 연습 - Region blank session')).toBeVisible()
  await expect(page.getByTestId('practice-stop-button')).toBeDisabled()
  await expect(page.getByRole('button', { name: '원음 우선' })).toBeVisible()
  await expect(page.getByRole('button', { name: '연주음만' })).toBeVisible()
  await expect(page.getByTestId('practice-waterfall-stage')).toBeVisible()
  await expect(page.locator('.practice-track-picker label.is-empty')).toHaveCount(6)
  await expect(page.getByTestId('practice-track-checkbox-1')).toBeDisabled()
  await expect(page.getByTestId('practice-track-checkbox-6')).toBeDisabled()
  await expect(page.getByTestId('practice-score-button')).toBeDisabled()
  await expect(page.getByText('음표 없음')).toBeVisible()
})

test('document-start studio flows through studio, region editor, and practice waterfall', async ({ page }) => {
  await createStudioFromSopranoMusicXml(page, 'Region import session')

  await expectRegisteredRegion(page, 1, ['C5', 'G5'])
  await expect(page.locator('[data-testid^="track-event-mini-"]').first()).toBeVisible()
  await openNoteEditorForRegion(page, 1, ['C5', 'G5'])
  const c5EventTestId = await page.locator('.piano-roll__event[title*="C5"]').first().getAttribute('data-testid')
  if (!c5EventTestId) {
    throw new Error('Expected imported piano-roll event to expose a stable test id')
  }
  const c5EventId = c5EventTestId.replace('piano-event-', '')
  const editUrl = page.url().split('?')[0]
  await page.goto(`${editUrl}?region=track-1-region-1&event=${encodeURIComponent(c5EventId)}`)
  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+\/edit\?/)
  await expect(page.getByTestId('track-region-1')).toHaveClass(/is-focused/)
  await expect(page.getByTestId(c5EventTestId)).toHaveClass(/is-focused/)
  await expect(page.getByText('음 이름')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '앞당기기' })).toBeVisible()
  await expect(page.getByRole('button', { name: '늦추기' })).toBeVisible()
  await expect(page.getByRole('button', { name: '박자 맞춤' })).toBeVisible()
  await expect(page.getByRole('button', { name: '음 제거' })).toBeVisible()

  await page.getByLabel('시작 위치', { exact: true }).fill('0.25')
  await page.locator('.region-draft-grid').getByLabel('길이', { exact: true }).fill('2.25')
  await page.getByLabel('음높이').fill('73')
  await expect(page.getByTestId('selected-midi-note-name')).toHaveText('C#5')
  await expect(page.locator('.piano-roll__event[title*="C#5"]')).toBeVisible()

  await page.getByTestId('purpose-nav-practice').click()
  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+\/practice$/)
  await expect(page.locator('.practice-stage__event[title*="C5"]')).toBeVisible()
  await expect(page.getByTestId('practice-score-button')).toBeEnabled()
  await page.getByTestId('practice-score-button').click()
  await expect(page.getByTestId('score-start-button')).toBeVisible()
  await expect(page.getByText('소프라노 채점')).toBeVisible()
  await page.getByRole('button', { name: '채점 체크리스트 닫기' }).click()
  await expect(page.locator('.practice-stage__event[title*="C#5"]')).toHaveCount(0)

  await page.getByTestId('purpose-nav-editor').click()
  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+\/edit$/)
  await expect(page.locator('.piano-roll__event[title*="C#5"]')).toBeVisible()

  await page.getByTestId('save-region-draft-button').click()
  await expect(page.locator('.piano-roll__event[title*="C#5"]')).toBeVisible()
  await expect(page.getByTestId('track-region-1')).toHaveAttribute('aria-label', /0.25초/)

  await page.getByTestId('purpose-nav-practice').click()
  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+\/practice$/)
  await expect(page.locator('.practice-stage__event[title*="C#5"]')).toBeVisible()

  await page.getByTestId('purpose-nav-editor').click()
  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+\/edit$/)

  await page.getByRole('button', { name: '이 버전으로 되돌리기' }).click()
  await expect(page.locator('.piano-roll__event[title*="C5"]')).toBeVisible()
  await expect(page.getByTestId('track-region-1')).toHaveAttribute('aria-label', /0.00초/)

  await page.getByTestId('purpose-nav-practice').click()
  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+\/practice$/)
  await expect(page.getByTestId('practice-track-checkbox-1')).toBeChecked()
  await expect(page.getByTestId('practice-waterfall-stage')).toContainText('소프라노')
  await expect(page.locator('.practice-stage__event[title*="C5"]')).toBeVisible()
  await expect(page.locator('.practice-stage__event[title*="G5"]')).toBeVisible()
})

test('AI generation registers a second editable region', async ({ page }) => {
  await createStudioFromSopranoMusicXml(page, 'Region AI session')

  await expect(page.getByTestId('track-generate-2')).toBeEnabled()
  await page.getByTestId('track-generate-2').click()
  await expect(page.getByTestId('candidate-review')).toContainText('후보')
  await approveFirstCandidate(page)

  await expectRegisteredRegion(page, 2, ['E4', 'G4'])
  await expect(page.locator('.studio-tracks__summary')).toContainText('등록 2')
})

test('track recording chooses reference playback before count-in', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium uses fake microphone input for recording gates')

  await createStudioFromSopranoMusicXml(page, 'Recording reference session')

  await page.getByTestId('track-record-2').click()
  await expect(page.getByTestId('recording-reference-dialog')).toBeVisible()
  await expect(page.getByTestId('recording-reference-track-1')).toBeChecked()
  await expect(page.getByTestId('recording-reference-track-2')).toBeDisabled()
  await expect(page.getByTestId('recording-reference-track-6')).toBeDisabled()
  await expect(page.getByTestId('recording-reference-metronome')).toBeChecked()

  await page.getByTestId('recording-reference-start').click()
  await expect(page.getByTestId('track-count-in-2')).toBeVisible()
  await expect(page.getByTestId('track-recording-meter-2')).toBeVisible({ timeout: 6_000 })
  await page.waitForTimeout(350)
  await page.getByTestId('track-record-2').click()
  await expect(page.getByTestId('pending-recording-dialog')).toBeVisible()
})
