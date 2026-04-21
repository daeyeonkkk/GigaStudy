import { expect, test, type Page } from '@playwright/test'

const musicXmlUpload = `<?xml version="1.0" encoding="UTF-8"?>
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

const threeFourMusicXmlUpload = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Soprano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>3</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration></note>
    </measure>
    <measure number="2">
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration></note>
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
  await expect(page.getByTestId('track-card-1')).toBeVisible()
}

async function uploadSopranoMusicXml(page: Page, xml: string, name: string) {
  await page.locator('[data-testid="track-card-1"] input[type="file"]').setInputFiles({
    name,
    mimeType: 'application/vnd.recordare.musicxml+xml',
    buffer: Buffer.from(xml, 'utf-8'),
  })
  await expect(page.getByTestId('candidate-review')).toContainText('Soprano')
}

async function approveFirstCandidate(page: Page) {
  await page.getByTestId('candidate-review').locator('button').first().click()
  await expect(page.getByTestId('candidate-review')).toBeHidden()
}

test('home keeps upload and blank start flows separate', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('upload-and-start-button')).toBeHidden()
  await expect(page.getByTestId('start-blank-button')).toBeVisible()
  await expect(page.getByTestId('studio-bpm-input')).toBeVisible()
  await expect(page.getByTestId('studio-time-signature-numerator')).toBeVisible()

  await page.getByTestId('studio-title-input').fill('Blank button without upload')
  await page.getByTestId('start-blank-button').click()
  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+$/)
  await expect(page.getByTestId('track-card-1')).toContainText('공란')

  await page.goto('/')
  await page.getByTestId('studio-title-input').fill('Home upload no tempo inputs')
  await page.getByTestId('studio-source-input').setInputFiles({
    name: 'home-start.musicxml',
    mimeType: 'application/vnd.recordare.musicxml+xml',
    buffer: Buffer.from(musicXmlUpload, 'utf-8'),
  })
  await expect(page.getByTestId('upload-and-start-button')).toBeVisible()
  await expect(page.getByTestId('start-blank-button')).toBeHidden()
  await expect(page.getByTestId('studio-bpm-input')).toHaveCount(0)
  await expect(page.getByTestId('studio-time-signature-numerator')).toHaveCount(0)

  await page.getByTestId('upload-and-start-button').click()
  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+$/)
  await expect(page.getByTestId('track-card-1')).toContainText('C5')
})

test('six-track studio supports create, register, generate, sync, play, and score', async ({ page }) => {
  await createBlankStudio(page, 'Playwright six-track session', '104')

  await uploadSopranoMusicXml(page, musicXmlUpload, 'soprano.musicxml')
  await expect(page.getByTestId('candidate-review')).toContainText('Preview: C5@1')
  await approveFirstCandidate(page)
  await expect(page.getByTestId('track-card-1')).toContainText('C5')
  await expect(page.getByTestId('track-generate-1')).toBeDisabled()

  const pdfDownloadPromise = page.waitForEvent('download')
  await page.getByTestId('export-pdf-button').click()
  const pdfDownload = await pdfDownloadPromise
  expect(pdfDownload.suggestedFilename()).toContain('score.pdf')
  expect(await pdfDownload.failure()).toBeNull()

  const sopranoOverflow = await page.getByTestId('track-score-strip-1').evaluate((strip) => {
    const scoreViewport = strip.parentElement
    return {
      clientWidth: scoreViewport?.clientWidth ?? 0,
      scrollWidth: scoreViewport?.scrollWidth ?? 0,
    }
  })
  expect(sopranoOverflow.scrollWidth).toBeGreaterThan(sopranoOverflow.clientWidth)

  await expect(page.getByTestId('track-generate-2')).toBeEnabled()
  await page.getByTestId('track-generate-2').click()
  await expect(page.getByTestId('candidate-review')).toContainText('Candidate 1')
  await expect(page.getByTestId('candidate-review')).toContainText('Candidate 3')
  await approveFirstCandidate(page)
  await expect(page.getByTestId('track-card-2')).toContainText('Voice-leading harmony score')
  await expect(page.locator('[data-testid="track-score-strip-2"] .track-card__measure-note')).toHaveCount(2)

  const altoFirstNoteBeforeSync = await page
    .locator('[data-testid="track-score-strip-2"] .track-card__measure-note')
    .first()
    .boundingBox()
  const altoFirstBarBeforeSync = await page
    .locator('[data-testid="track-score-strip-2"] .track-card__beat-line--measure')
    .first()
    .boundingBox()
  await page.getByTestId('track-sync-later-2').click()
  await expect(page.getByTestId('track-card-2')).toContainText('sync +0.01s')
  const altoFirstNoteAfterSync = await page
    .locator('[data-testid="track-score-strip-2"] .track-card__measure-note')
    .first()
    .boundingBox()
  const altoFirstBarAfterSync = await page
    .locator('[data-testid="track-score-strip-2"] .track-card__beat-line--measure')
    .first()
    .boundingBox()
  expect(altoFirstNoteBeforeSync).not.toBeNull()
  expect(altoFirstNoteAfterSync).not.toBeNull()
  expect(altoFirstBarBeforeSync).not.toBeNull()
  expect(altoFirstBarAfterSync).not.toBeNull()
  expect(altoFirstNoteAfterSync!.x).toBeGreaterThan(altoFirstNoteBeforeSync!.x + 1)
  expect(Math.abs(altoFirstBarAfterSync!.x - altoFirstBarBeforeSync!.x)).toBeLessThan(0.5)

  await page.getByTestId('global-play-button').click()
  await expect(page.getByTestId('global-stop-button')).toBeEnabled()
  await page.getByTestId('global-stop-button').click()

  await page.getByTestId('track-score-1').click()
  await expect(page.getByTestId('score-start-button')).toBeVisible()
  await page.getByTestId('score-start-button').click()
  await page.getByTestId('score-stop-button').click()

  await expect(page.getByTestId('report-feed')).toContainText('Soprano')
  const reportLink = page.locator('[data-testid^="report-open-"]').first()
  await expect(reportLink).toBeVisible()
  await expect(page.getByTestId('report-feed')).not.toContainText('Overall')

  await reportLink.click()
  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+\/reports\/[a-f0-9]+$/)
  await expect(page.getByTestId('report-detail')).toContainText('Soprano')
  await expect(page.getByTestId('report-detail')).toContainText('Pitch')
  await expect(page.getByTestId('report-detail')).toContainText('Auto Sync')
  await expect(page.getByTestId('report-issues')).toBeVisible()
})

test('track upload can create and approve an extraction candidate', async ({ page }) => {
  await createBlankStudio(page, 'Candidate review session')

  await uploadSopranoMusicXml(page, musicXmlUpload, 'soprano.musicxml')
  await expect(page.getByTestId('candidate-review')).toContainText('Preview: C5@1')
  await page.locator('[data-testid^="candidate-target-"]').selectOption('2')
  await approveFirstCandidate(page)

  await expect(page.getByTestId('track-card-2')).toContainText('C5')
  await expect(page.getByTestId('track-card-2')).toContainText('G5')
})

test('symbolic upload drives the studio time-signature score grid', async ({ page }) => {
  await createBlankStudio(page, 'Three four grid session')

  await uploadSopranoMusicXml(page, threeFourMusicXmlUpload, 'three-four.musicxml')
  await approveFirstCandidate(page)

  await expect(page.locator('.composer-score-heading')).toContainText('3/4')
  await expect(page.getByTestId('track-card-1')).toContainText('F5')

  const beatLabels = await page
    .locator('[data-testid="track-score-strip-1"] .track-card__measure-note small')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()))
  expect(beatLabels.slice(0, 4)).toEqual(['1', '2', '3', '1'])

  const measureLineXs = await page
    .locator('[data-testid="track-score-strip-1"] .track-card__beat-line--measure')
    .evaluateAll((nodes) => nodes.slice(0, 3).map((node) => node.getBoundingClientRect().x))
  const beatLineXs = await page
    .locator('[data-testid="track-score-strip-1"] .track-card__beat-line:not(.track-card__beat-line--measure)')
    .evaluateAll((nodes) => nodes.slice(0, 2).map((node) => node.getBoundingClientRect().x))
  expect(measureLineXs).toHaveLength(3)
  expect(beatLineXs).toHaveLength(2)
  const beatGap = beatLineXs[1] - beatLineXs[0]
  const measureGap = measureLineXs[1] - measureLineXs[0]
  expect(Math.abs(measureGap - beatGap * 3)).toBeLessThan(1)
})
