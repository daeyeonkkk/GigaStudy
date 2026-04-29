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

const denseMusicXmlUpload = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Soprano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>A</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>B</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>C</step><octave>6</octave></pitch><duration>1</duration></note>
      <note><pitch><step>B</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>A</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
</score-partwise>
`

const durationAndTieMusicXmlUpload = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Soprano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>2</duration><type>eighth</type></note>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>1</duration><type>16th</type></note>
    </measure>
    <measure number="3">
      <note>
        <pitch><step>A</step><octave>5</octave></pitch>
        <duration>16</duration>
        <tie type="start" />
        <notations><tied type="start" /></notations>
      </note>
    </measure>
    <measure number="4">
      <note>
        <pitch><step>A</step><octave>5</octave></pitch>
        <duration>16</duration>
        <tie type="stop" />
        <notations><tied type="stop" /></notations>
      </note>
    </measure>
  </part>
</score-partwise>
`

const keySignatureMusicXmlUpload = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Soprano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <key><fifths>-1</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><type>eighth</type></note>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>1</duration><type>eighth</type></note>
      <note><pitch><step>A</step><octave>5</octave></pitch><duration>1</duration><type>eighth</type></note>
      <note><pitch><step>B</step><alter>-1</alter><octave>5</octave></pitch><duration>1</duration><type>eighth</type></note>
      <note><pitch><step>C</step><octave>6</octave></pitch><duration>1</duration><type>eighth</type></note>
      <note><pitch><step>D</step><octave>6</octave></pitch><duration>1</duration><type>eighth</type></note>
      <note><pitch><step>E</step><octave>6</octave></pitch><duration>1</duration><type>eighth</type></note>
      <note><pitch><step>F</step><octave>6</octave></pitch><duration>1</duration><type>eighth</type></note>
    </measure>
  </part>
</score-partwise>
`

async function createBlankStudio(page: Page, title: string, bpm = '120') {
  await page.goto('/')
  const titleInput = page.getByTestId('studio-title-input')
  const bpmInput = page.getByTestId('studio-bpm-input')
  await titleInput.fill(title)
  await expect(titleInput).toHaveValue(title)
  await bpmInput.fill(bpm)
  await expect(bpmInput).toHaveValue(bpm)
  await expect(page.getByTestId('start-blank-button')).toBeEnabled()
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

async function expectTrackScoreNote(page: Page, slotId: number, label: string) {
  await expect(page.getByTestId(`track-score-strip-${slotId}`)).toBeVisible()
  await expect(
    page.locator(`[data-testid="track-score-strip-${slotId}"] .track-card__engraving-marker[aria-label^="${label} "]`),
  ).not.toHaveCount(0)
}

async function uploadMusicXmlToTrack(page: Page, slotId: number, xml: string, name: string) {
  await page.locator(`[data-testid="track-card-${slotId}"] input[type="file"]`).setInputFiles({
    name,
    mimeType: 'application/vnd.recordare.musicxml+xml',
    buffer: Buffer.from(xml, 'utf-8'),
  })
  await expect(page.getByTestId('candidate-review')).toContainText('Soprano')
  await page.locator('[data-testid^="candidate-target-"]').first().selectOption(String(slotId))
  await approveFirstCandidate(page)
  await expectTrackScoreNote(page, slotId, 'C5')
}

async function uploadAudioToTrack(page: Page, slotId: number, filename: string) {
  await page.locator(`[data-testid="track-card-${slotId}"] input[type="file"]`).setInputFiles({
    name: filename,
    mimeType: 'audio/mpeg',
    buffer: Buffer.from(`${filename} browser audio fixture`, 'utf-8'),
  })
  await expect(page.getByTestId('candidate-review')).toContainText('.wav')
  await page.locator('[data-testid^="candidate-target-"]').first().selectOption(String(slotId))
  await approveFirstCandidate(page)
  await expect(page.getByTestId(`track-card-${slotId}`)).toContainText('등록 완료')
}

async function installDecodedAudioUploadStub(page: Page) {
  await page.addInitScript(() => {
    const playbackWindow = window as Window & {
      __gigastudyAudioFetchCalls?: string[]
      __gigastudyBufferPlayCalls?: Array<{
        bufferDuration: number
        durationSeconds: number | undefined
        offsetSeconds: number
        startTime: number
      }>
      __gigastudyToneStarts?: Array<{ frequency: number; startTime: number }>
    }
    playbackWindow.__gigastudyAudioFetchCalls = []
    playbackWindow.__gigastudyBufferPlayCalls = []
    playbackWindow.__gigastudyToneStarts = []
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      if (url.includes('/tracks/') && url.includes('/audio')) {
        playbackWindow.__gigastudyAudioFetchCalls?.push(url)
      }
      return originalFetch(input, init)
    }

    class FakeAudioParam {
      value = 0

      cancelScheduledValues() {
        return undefined
      }

      exponentialRampToValueAtTime(value: number) {
        this.value = value
        return undefined
      }

      linearRampToValueAtTime(value: number) {
        this.value = value
        return undefined
      }

      setValueAtTime(value: number) {
        this.value = value
        return undefined
      }
    }

    class FakeAudioNode {
      connect() {
        return this
      }

      disconnect() {
        return undefined
      }
    }

    class FakeOscillatorNode extends FakeAudioNode {
      frequency = new FakeAudioParam()
      type: OscillatorType = 'sine'

      start(startTime: number) {
        playbackWindow.__gigastudyToneStarts?.push({ frequency: this.frequency.value, startTime })
        return undefined
      }

      stop() {
        return undefined
      }
    }

    class FakeBufferSourceNode extends FakeAudioNode {
      buffer: AudioBuffer | null = null

      start(startTime: number, offsetSeconds = 0, durationSeconds?: number) {
        playbackWindow.__gigastudyBufferPlayCalls?.push({
          bufferDuration: this.buffer?.duration ?? 0,
          durationSeconds,
          offsetSeconds,
          startTime,
        })
      }

      stop() {
        return undefined
      }
    }

    class FakeAudioContext {
      currentTime = 12
      destination = new FakeAudioNode()
      state = 'running'

      createBiquadFilter() {
        const filter = new FakeAudioNode() as FakeAudioNode & {
          frequency: FakeAudioParam
          Q: FakeAudioParam
          type: BiquadFilterType
        }
        filter.frequency = new FakeAudioParam()
        filter.Q = new FakeAudioParam()
        filter.type = 'lowpass'
        return filter
      }

      createGain() {
        const gain = new FakeAudioNode() as FakeAudioNode & { gain: FakeAudioParam }
        gain.gain = new FakeAudioParam()
        return gain
      }

      createOscillator() {
        return new FakeOscillatorNode()
      }

      createBufferSource() {
        return new FakeBufferSourceNode()
      }

      async decodeAudioData() {
        const sampleRate = 16_000
        const length = sampleRate * 2
        const samples = new Float32Array(length)
        const events: Array<[number, number, number]> = [
          [0.25, 0.65, 523.251],
          [1.0, 0.65, 659.255],
        ]
        for (const [startSeconds, durationSeconds, frequency] of events) {
          const start = Math.floor(startSeconds * sampleRate)
          const end = Math.min(length, Math.floor((startSeconds + durationSeconds) * sampleRate))
          for (let index = start; index < end; index += 1) {
            const phase = (2 * Math.PI * frequency * (index - start)) / sampleRate
            samples[index] = Math.sin(phase) * 0.28
          }
        }
        return {
          sampleRate,
          length,
          duration: length / sampleRate,
          numberOfChannels: 1,
          getChannelData: () => samples,
        }
      }

      async close() {
        this.state = 'closed'
      }

      async resume() {
        this.state = 'running'
      }
    }

    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
      writable: true,
    })
    Object.defineProperty(window, 'webkitAudioContext', {
      configurable: true,
      value: FakeAudioContext,
      writable: true,
    })
  })
}

async function installScorePlaybackClockStub(page: Page) {
  await page.addInitScript(() => {
    const playbackWindow = window as Window & {
      __gigastudyToneStarts?: Array<{ frequency: number; startTime: number }>
    }
    const toneStarts: Array<{ frequency: number; startTime: number }> = []
    playbackWindow.__gigastudyToneStarts = toneStarts

    class FakeAudioParam {
      value = 0

      cancelScheduledValues() {
        return undefined
      }

      exponentialRampToValueAtTime(value: number) {
        this.value = value
        return undefined
      }

      linearRampToValueAtTime(value: number) {
        this.value = value
        return undefined
      }

      setValueAtTime(value: number) {
        this.value = value
        return undefined
      }
    }

    class FakeAudioNode {
      connect() {
        return this
      }

      disconnect() {
        return undefined
      }
    }

    class FakeOscillatorNode extends FakeAudioNode {
      frequency = new FakeAudioParam()
      type: OscillatorType = 'sine'

      start(startTime: number) {
        toneStarts.push({ frequency: this.frequency.value, startTime })
      }

      stop() {
        return undefined
      }
    }

    class FakeAudioContext {
      currentTime = 12
      destination = new FakeAudioNode()
      state = 'running'

      createBiquadFilter() {
        const filter = new FakeAudioNode() as FakeAudioNode & {
          frequency: FakeAudioParam
          Q: FakeAudioParam
          type: BiquadFilterType
        }
        filter.frequency = new FakeAudioParam()
        filter.Q = new FakeAudioParam()
        filter.type = 'lowpass'
        return filter
      }

      createGain() {
        const gain = new FakeAudioNode() as FakeAudioNode & { gain: FakeAudioParam }
        gain.gain = new FakeAudioParam()
        return gain
      }

      createOscillator() {
        return new FakeOscillatorNode()
      }

      async close() {
        this.state = 'closed'
      }

      async resume() {
        this.state = 'running'
      }
    }

    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
      writable: true,
    })
    Object.defineProperty(window, 'webkitAudioContext', {
      configurable: true,
      value: FakeAudioContext,
      writable: true,
    })
  })
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
  await expectTrackScoreNote(page, 1, 'C5')
})

test('home music upload decodes MP3-like input to WAV before analysis', async ({ page }) => {
  await installDecodedAudioUploadStub(page)
  await page.goto('/')
  await page.getByTestId('studio-title-input').fill('Home decoded audio upload')
  await page.getByTestId('studio-source-input').setInputFiles({
    name: 'home-voice.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('browser decodes this fixture through a stub', 'utf-8'),
  })

  await page.getByTestId('upload-and-start-button').click()
  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+$/, { timeout: 45_000 })
  await expect(page.getByTestId('candidate-review')).toContainText('home-voice.wav')
  await expect(page.getByTestId('candidate-review')).toContainText('C5')
})

test('registered audio track playback uses retained audio buffer', async ({ page }) => {
  await installDecodedAudioUploadStub(page)
  await page.goto('/')
  await page.getByTestId('studio-title-input').fill('Direct retained audio playback')
  await page.getByTestId('studio-source-input').setInputFiles({
    name: 'direct-playback.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('browser decodes this fixture through a stub', 'utf-8'),
  })

  await page.getByTestId('upload-and-start-button').click()
  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+$/, { timeout: 45_000 })
  await approveFirstCandidate(page)
  await expectTrackScoreNote(page, 1, 'C5')

  await page.locator('.composer-metronome input').uncheck()
  await page.getByTestId('global-play-button').click()
  await page.getByTestId('selected-play-button').click()
  await expect(page.getByTestId('track-playhead-1')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __gigastudyBufferPlayCalls?: Array<{
                bufferDuration: number
                durationSeconds: number | undefined
                offsetSeconds: number
                startTime: number
              }>
            }
          ).__gigastudyBufferPlayCalls ?? [],
      ),
    )
    .toEqual([
      expect.objectContaining({
        bufferDuration: 2,
        offsetSeconds: 0,
        startTime: 12.08,
      }),
    ])
  const fetchCalls = await page.evaluate(
    () => (window as Window & { __gigastudyAudioFetchCalls?: string[] }).__gigastudyAudioFetchCalls ?? [],
  )
  expect(fetchCalls.some((url) => url.includes('/tracks/1/audio'))).toBe(true)
})

test('global audio playback schedules retained tracks on the same audio clock', async ({ page }) => {
  await installDecodedAudioUploadStub(page)
  await createBlankStudio(page, 'Prepared global audio playback')

  await uploadAudioToTrack(page, 1, 'soprano-ready-late.mp3')
  await uploadAudioToTrack(page, 2, 'alto-ready-now.mp3')

  await page.locator('.composer-metronome input').uncheck()
  await page.getByTestId('global-play-button').click()
  await page.getByTestId('selected-play-button').click()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __gigastudyBufferPlayCalls?: Array<{ offsetSeconds: number; startTime: number }>
            }
          ).__gigastudyBufferPlayCalls ?? [],
      ),
    )
    .toHaveLength(2)
  const playCalls = await page.evaluate(
    () =>
      (
        window as Window & {
          __gigastudyBufferPlayCalls?: Array<{ offsetSeconds: number; startTime: number }>
        }
      ).__gigastudyBufferPlayCalls ?? [],
  )

  expect(playCalls.map((call) => call.offsetSeconds)).toEqual([0, 0])
  expect(Math.abs(playCalls[0].startTime - playCalls[1].startTime)).toBeLessThan(0.001)
  const fetchCalls = await page.evaluate(
    () => (window as Window & { __gigastudyAudioFetchCalls?: string[] }).__gigastudyAudioFetchCalls ?? [],
  )
  expect(fetchCalls.some((url) => url.includes('/tracks/1/audio'))).toBe(true)
  expect(fetchCalls.some((url) => url.includes('/tracks/2/audio'))).toBe(true)
})

test('retained audio shares the metronome audio clock', async ({ page }) => {
  await installDecodedAudioUploadStub(page)
  await page.goto('/')
  await page.getByTestId('studio-title-input').fill('Metronome synchronized audio playback')
  await page.getByTestId('studio-source-input').setInputFiles({
    name: 'metronome-sync.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('browser decodes this fixture through a stub', 'utf-8'),
  })

  await page.getByTestId('upload-and-start-button').click()
  await expect(page).toHaveURL(/\/studios\/[a-f0-9]+$/, { timeout: 45_000 })
  await approveFirstCandidate(page)

  await page.getByTestId('global-play-button').click()
  await page.getByTestId('selected-play-button').click()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __gigastudyBufferPlayCalls?: Array<{ offsetSeconds: number; startTime: number }>
            }
          ).__gigastudyBufferPlayCalls ?? [],
      ),
    )
    .toEqual([
      expect.objectContaining({
        offsetSeconds: 0,
        startTime: 12.08,
      }),
    ])

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __gigastudyToneStarts?: Array<{ frequency: number; startTime: number }>
            }
          ).__gigastudyToneStarts ?? [],
      ),
    )
    .not.toHaveLength(0)
  const firstToneStart = await page.evaluate(
    () => (window as Window & { __gigastudyToneStarts?: Array<{ startTime: number }> }).__gigastudyToneStarts?.[0]?.startTime,
  )
  const firstBufferStart = await page.evaluate(
    () =>
      (window as Window & { __gigastudyBufferPlayCalls?: Array<{ startTime: number }> })
        .__gigastudyBufferPlayCalls?.[0]?.startTime,
  )
  expect(firstToneStart).toBe(firstBufferStart)
})

test('score playback schedules stacked track notes on the same audio clock', async ({ page }) => {
  await installScorePlaybackClockStub(page)
  await createBlankStudio(page, 'Score chord clock playback')

  await uploadMusicXmlToTrack(page, 1, musicXmlUpload, 'soprano-clock.musicxml')
  await uploadMusicXmlToTrack(page, 2, musicXmlUpload, 'alto-clock.musicxml')

  await page.locator('.composer-metronome input').uncheck()
  await page.getByTestId('playback-source-score').click()
  await page.getByTestId('global-play-button').click()
  await page.getByTestId('selected-play-button').click()

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __gigastudyToneStarts?: Array<{ frequency: number; startTime: number }>
            }
          ).__gigastudyToneStarts ?? [],
      ),
    )
    .toHaveLength(12)
  const toneStarts = await page.evaluate(
    () =>
      (
        window as Window & {
          __gigastudyToneStarts?: Array<{ frequency: number; startTime: number }>
        }
      ).__gigastudyToneStarts ?? [],
  )

  const startTimes = [...new Set(toneStarts.map((entry) => Number(entry.startTime.toFixed(3))))].sort(
    (left, right) => left - right,
  )
  expect(startTimes).toHaveLength(2)
  const firstChord = toneStarts.filter((entry) => Math.abs(entry.startTime - startTimes[0]) < 0.001)
  expect(firstChord).toHaveLength(6)
  expect(firstChord.every((entry) => Math.abs(entry.startTime - firstChord[0].startTime) < 0.001)).toBe(true)
})

test('track recording shows zero on the count-in downbeat before capture continues', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium project supplies fake microphone permissions.')

  await createBlankStudio(page, 'Count-in recording grid', '240')

  await page.getByTestId('track-record-1').click()
  await expect(page.getByTestId('track-count-in-1')).toContainText('1마디 준비')
  await expect(page.getByTestId('track-count-in-1')).toContainText('4')
  await expect(page.getByTestId('track-recording-meter-1')).toHaveCount(0)

  await page.waitForFunction(() => document.querySelector('[data-testid="track-count-in-1"]')?.textContent?.includes('0'))
  await expect(page.getByTestId('track-recording-meter-1')).toBeVisible()
  await page.waitForTimeout(250)
  await page.getByTestId('track-record-1').click()
  await expect(page.getByTestId('pending-recording-dialog')).toBeVisible()
  await page.getByTestId('pending-recording-discard').click()
  await expect(page.getByTestId('pending-recording-dialog')).toHaveCount(0)
})

test('admin login can inspect storage and run the engine queue trigger', async ({ page }) => {
  await page.goto('/admin')
  await page.getByLabel('ID').fill('admin')
  await page.getByLabel('Password').fill('대연123')
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page.getByText('Storage backend')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run Queue' })).toBeVisible()

  await page.getByRole('button', { name: 'Run Queue' }).click()

  await expect(page.getByText(/Engine queue processed/)).toBeVisible()
})

test('six-track studio supports create, register, generate, sync, play, and score', async ({ page }) => {
  await createBlankStudio(page, 'Playwright six-track session', '104')

  await uploadSopranoMusicXml(page, musicXmlUpload, 'soprano.musicxml')
  await expect(page.getByTestId('candidate-review')).toContainText('C5@1')
  await expect(page.getByTestId('candidate-review')).toContainText('선택 기준')
  await approveFirstCandidate(page)
  await expectTrackScoreNote(page, 1, 'C5')
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
  await expect(page.getByTestId('candidate-review')).toContainText('Balanced')
  await expect(page.getByTestId('candidate-review')).toContainText('Lower support')
  await expect(page.getByTestId('candidate-review')).toContainText('Upper blend')
  await expect(page.getByTestId('candidate-review')).toContainText('avg')
  await expect(page.getByTestId('candidate-review')).not.toContainText('Candidate 1')
  await expect(page.getByTestId('candidate-review')).toContainText('움직임')
  await approveFirstCandidate(page)
  await expect(page.getByTestId('track-card-2')).toContainText('Voice-leading harmony score')
  await expect(page.locator('[data-testid="track-score-strip-2"] .track-card__measure-note')).toHaveCount(2)

  const sopranoSecondMeasureLine = await page
    .locator('[data-testid="track-score-strip-1"] .track-card__beat-line--measure')
    .nth(1)
    .boundingBox()
  const altoSecondMeasureLine = await page
    .locator('[data-testid="track-score-strip-2"] .track-card__beat-line--measure')
    .nth(1)
    .boundingBox()
  expect(sopranoSecondMeasureLine).not.toBeNull()
  expect(altoSecondMeasureLine).not.toBeNull()
  expect(Math.abs(sopranoSecondMeasureLine!.x - altoSecondMeasureLine!.x)).toBeLessThan(0.5)

  const altoFirstNoteBeforeSync = await page
    .locator('[data-testid="track-score-strip-2"] .track-card__measure-note')
    .first()
    .boundingBox()
  const altoFirstBarBeforeSync = await page
    .locator('[data-testid="track-score-strip-2"] .track-card__beat-line--measure')
    .first()
    .boundingBox()
  await page.getByTestId('sync-step-input').fill('0.025')
  await page.getByTestId('track-sync-later-2').click()
  await expect(page.getByTestId('track-card-2')).toContainText('sync +0.025s')
  await page.getByTestId('track-volume-input-2').fill('42')
  await page.getByTestId('track-volume-input-2').press('Enter')
  await expect(page.getByTestId('track-card-2')).toContainText('vol 42%')
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

  const browserSupportsScoreAudio = await page.evaluate(
    () => Boolean(window.AudioContext || ('webkitAudioContext' in window)),
  )
  await page.getByTestId('global-play-button').click()
  await expect(page.getByTestId('selected-playback-panel')).toBeVisible()
  await page.getByTestId('playback-track-checkbox-1').uncheck()
  await page.getByTestId('selected-play-button').click()
  await expect(page.getByTestId('global-stop-button')).toBeEnabled()
  if (browserSupportsScoreAudio) {
    await expect(page.getByTestId('track-playhead-2')).toBeVisible()
    await expect(page.getByTestId('track-playhead-1')).toHaveCount(0)
    await page.getByTestId('selected-playback-seek').evaluate((element) => {
      const input = element as HTMLInputElement
      input.value = '0.25'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })
    await expect(page.getByTestId('track-playhead-2')).toBeVisible()
    const playheadBefore = await page.evaluate(() => {
      const getRect = (testId: string) => {
        const rect = document.querySelector(`[data-testid="${testId}"]`)?.getBoundingClientRect()
        return rect ? { x: rect.x } : null
      }
      return {
        alto: getRect('track-playhead-2'),
      }
    })
    await page.waitForTimeout(250)
    const playheadAfter = await page.evaluate(() => {
      const getRect = (testId: string) => {
        const rect = document.querySelector(`[data-testid="${testId}"]`)?.getBoundingClientRect()
        return rect ? { x: rect.x } : null
      }
      return {
        alto: getRect('track-playhead-2'),
      }
    })
    expect(playheadBefore.alto).not.toBeNull()
    expect(playheadAfter.alto).not.toBeNull()
    expect(playheadAfter.alto!.x).toBeGreaterThan(playheadBefore.alto!.x + 2)
  } else {
    await expect(page.getByText(/오디오 장치|audio/i)).toBeVisible()
  }
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
  await expect(page.getByTestId('candidate-review')).toContainText('C5@1')
  await page.locator('[data-testid^="candidate-target-"]').selectOption('2')
  await approveFirstCandidate(page)

  await expectTrackScoreNote(page, 2, 'C5')
  await expectTrackScoreNote(page, 2, 'G5')
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
  expect(beatLineXs[0]).toBeGreaterThan(measureLineXs[0])
  expect(beatLineXs[1]).toBeLessThan(measureLineXs[1])
  expect(measureGap).toBeGreaterThan(beatGap * 3)

  const noteCenters = await page
    .locator('[data-testid="track-score-strip-1"] .track-card__measure-note')
    .evaluateAll((nodes) =>
      nodes.slice(0, 4).map((node) => {
        const rect = node.getBoundingClientRect()
        return rect.x + rect.width / 2
      }),
    )
  expect(noteCenters[0]).toBeGreaterThan(measureLineXs[0])
  expect(noteCenters[2]).toBeLessThan(measureLineXs[1])
  expect(noteCenters[3]).toBeGreaterThan(measureLineXs[1])
  expect(noteCenters[3]).toBeLessThan(measureLineXs[2])
})

test('dense score notes stay inside their owning measure', async ({ page }) => {
  await createBlankStudio(page, 'Dense measure layout session')

  await uploadSopranoMusicXml(page, denseMusicXmlUpload, 'dense.musicxml')
  await approveFirstCandidate(page)

  const layout = await page.getByTestId('track-score-strip-1').evaluate((strip) => {
    const measureLines = [...strip.querySelectorAll('.track-card__beat-line--measure')].map((node) =>
      node.getBoundingClientRect().x,
    )
    const noteCenters = [...strip.querySelectorAll('.track-card__measure-note')].map((node) => {
      const rect = node.getBoundingClientRect()
      return rect.x + rect.width / 2
    })
    return {
      firstMeasureStart: measureLines[0],
      firstMeasureEnd: measureLines[1],
      noteCenters,
      viewportClientWidth: strip.parentElement?.clientWidth ?? 0,
      viewportScrollWidth: strip.parentElement?.scrollWidth ?? 0,
    }
  })

  expect(layout.noteCenters).toHaveLength(16)
  expect(layout.viewportScrollWidth).toBeGreaterThan(layout.viewportClientWidth)
  for (const center of layout.noteCenters) {
    expect(center).toBeGreaterThan(layout.firstMeasureStart)
    expect(center).toBeLessThan(layout.firstMeasureEnd)
  }

  const svgLayout = await page.getByTestId('track-score-strip-1').evaluate((strip) => {
    const measureLines = [...strip.querySelectorAll('.track-card__beat-line--measure')].map((node) =>
      node.getBoundingClientRect().x,
    )
    const staveNoteCenters = [...strip.querySelectorAll('.vf-stavenote')]
      .map((node) => {
        const rect = node.getBoundingClientRect()
        return rect.width > 0 ? rect.x + rect.width / 2 : null
      })
      .filter((value): value is number => value !== null)
    return {
      firstMeasureStart: measureLines[0],
      firstMeasureEnd: measureLines[1],
      staveNoteCenters,
    }
  })

  expect(svgLayout.staveNoteCenters.length).toBeGreaterThanOrEqual(16)
  for (const center of svgLayout.staveNoteCenters.slice(0, 16)) {
    expect(center).toBeGreaterThan(svgLayout.firstMeasureStart)
    expect(center).toBeLessThan(svgLayout.firstMeasureEnd)
  }
})

test('score rendering reflects note duration glyphs and ties', async ({ page }) => {
  await createBlankStudio(page, 'Duration glyph session')

  await uploadSopranoMusicXml(page, durationAndTieMusicXmlUpload, 'durations.musicxml')
  await approveFirstCandidate(page)

  const scoreStrip = page.getByTestId('track-score-strip-1')
  await expect(scoreStrip.locator('[data-duration="whole"]')).toHaveCount(3)
  await expect(scoreStrip.locator('[data-duration="half"]')).toHaveCount(1)
  await expect(scoreStrip.locator('[data-duration="quarter"]')).toHaveCount(1)
  await expect(scoreStrip.locator('[data-duration="eighth"]')).toHaveCount(1)
  await expect(scoreStrip.locator('[data-duration="sixteenth"]')).toHaveCount(1)
  await expect(scoreStrip.locator('.track-card__note--tie-start')).toHaveCount(1)
  await expect(scoreStrip.locator('.track-card__note--tie-stop')).toHaveCount(1)

  const tieCount = await scoreStrip.locator('.vf-stavetie').count()
  expect(tieCount).toBeGreaterThanOrEqual(1)
})

test('score engraving reserves key signature space before the first note', async ({ page }) => {
  await createBlankStudio(page, 'Key signature engraving session')

  await uploadSopranoMusicXml(page, keySignatureMusicXmlUpload, 'key-signature.musicxml')
  await approveFirstCandidate(page)

  const scoreStrip = page.getByTestId('track-score-strip-1')
  const layout = await scoreStrip.evaluate((strip) => {
    const keySignatureCandidates = [...strip.querySelectorAll('g')].filter((node) =>
      (node.getAttribute('class') ?? '').toLowerCase().includes('key'),
    )
    const keySignatureRight = Math.max(
      0,
      ...keySignatureCandidates.map((node) => {
        const rect = node.getBoundingClientRect()
        return rect.width > 0 ? rect.right : 0
      }),
    )
    const firstNoteRect = strip.querySelector('.vf-stavenote')?.getBoundingClientRect()
    return {
      firstNoteLeft: firstNoteRect?.left ?? 0,
      keySignatureCount: keySignatureCandidates.length,
      keySignatureRight,
    }
  })

  expect(layout.keySignatureCount).toBeGreaterThan(0)
  expect(layout.firstNoteLeft).toBeGreaterThan(layout.keySignatureRight + 4)
})
