import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { currentLaneTickets } from '../data/phase1'
import { buildApiUrl } from '../lib/api'
import type { Project } from '../types/project'

type StudioState =
  | { phase: 'loading' }
  | { phase: 'ready'; project: Project }
  | { phase: 'error'; message: string }

type ActionState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'success'; message: string }
  | { phase: 'error'; message: string }

type DeviceProfile = {
  device_profile_id: string
  user_id: string
  browser: string
  os: string
  input_device_hash: string
  output_route: string
  requested_constraints_json: Record<string, unknown> | null
  applied_settings_json: Record<string, unknown> | null
  actual_sample_rate: number | null
  channel_count: number | null
  input_latency_est: number | null
  base_latency: number | null
  output_latency: number | null
  calibration_method: string | null
  calibration_confidence: number | null
  created_at: string
  updated_at: string
}

type DeviceProfileListResponse = {
  items: DeviceProfile[]
}

type GuideTrack = {
  track_id: string
  project_id: string
  track_role: string
  track_status: string
  source_format: string | null
  duration_ms: number | null
  actual_sample_rate: number | null
  storage_key: string | null
  checksum: string | null
  source_artifact_url: string | null
  created_at: string
  updated_at: string
}

type GuideLookupResponse = {
  guide: GuideTrack | null
}

type GuideUploadInitResponse = {
  track_id: string
  upload_url: string
  method: 'PUT'
  storage_key: string
}

type DeviceProfileState =
  | { phase: 'loading'; profile: null }
  | { phase: 'ready'; profile: DeviceProfile | null }
  | { phase: 'error'; profile: null; message: string }

type GuideState =
  | { phase: 'loading'; guide: null }
  | { phase: 'ready'; guide: GuideTrack | null }
  | { phase: 'error'; guide: null; message: string }

type PermissionState =
  | { phase: 'idle' }
  | { phase: 'requesting' }
  | { phase: 'granted'; message: string }
  | { phase: 'error'; message: string }

type ConstraintDraft = {
  echoCancellation: boolean
  autoGainControl: boolean
  noiseSuppression: boolean
  channelCount: number
}

const defaultConstraintDraft: ConstraintDraft = {
  echoCancellation: true,
  autoGainControl: true,
  noiseSuppression: true,
  channelCount: 1,
}

const outputRouteOptions = [
  { value: 'headphones', label: 'Headphones recommended' },
  { value: 'speakers', label: 'Speakers / monitor' },
  { value: 'unknown', label: 'Unknown route' },
] as const

function detectBrowserName(userAgent: string): string {
  if (/Edg\//.test(userAgent)) {
    return 'Edge'
  }
  if (/Chrome\//.test(userAgent) && !/Edg\//.test(userAgent)) {
    return 'Chrome'
  }
  if (/Firefox\//.test(userAgent)) {
    return 'Firefox'
  }
  if (/Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)) {
    return 'Safari'
  }
  return 'Unknown browser'
}

function detectOsName(userAgent: string): string {
  if (/Windows NT/.test(userAgent)) {
    return 'Windows'
  }
  if (/Mac OS X/.test(userAgent)) {
    return 'macOS'
  }
  if (/Android/.test(userAgent)) {
    return 'Android'
  }
  if (/iPhone|iPad|iPod/.test(userAgent)) {
    return 'iOS'
  }
  if (/Linux/.test(userAgent)) {
    return 'Linux'
  }
  return 'Unknown OS'
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return 'Not captured yet'
  }

  return `${(durationMs / 1000).toFixed(2)} sec`
}

function pickNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getRequestedAudioConstraints(
  profile: DeviceProfile | null,
): Record<string, unknown> | null {
  if (!profile?.requested_constraints_json) {
    return null
  }

  const nestedAudio = profile.requested_constraints_json.audio
  if (nestedAudio && typeof nestedAudio === 'object') {
    return nestedAudio as Record<string, unknown>
  }

  return profile.requested_constraints_json
}

function getAudioContextOutputLatency(audioContext: AudioContext): number | null {
  const maybeWithOutput = audioContext as AudioContext & { outputLatency?: number }
  return pickNumber(maybeWithOutput.outputLatency)
}

function serializeTrackSettings(settings: MediaTrackSettings): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(settings).filter((entry) => entry[1] !== undefined),
  )
}

function getTrackLatency(settings: MediaTrackSettings): number | null {
  const withLatency = settings as MediaTrackSettings & { latency?: number }
  return pickNumber(withLatency.latency)
}

function toPrettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2)
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: unknown }
    if (typeof payload.detail === 'string') {
      return payload.detail
    }
  } catch {
    return fallback
  }

  return fallback
}

async function hashValue(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return value
  }

  const encoded = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('')
}

async function extractAudioFileMetadata(file: File): Promise<{
  actualSampleRate: number | null
  durationMs: number | null
}> {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
    return { actualSampleRate: null, durationMs: null }
  }

  const audioContext = new AudioContext()

  try {
    const encodedAudio = await file.arrayBuffer()
    const decodedAudio = await audioContext.decodeAudioData(encodedAudio.slice(0))
    return {
      actualSampleRate: decodedAudio.sampleRate,
      durationMs: Math.round(decodedAudio.duration * 1000),
    }
  } catch {
    return { actualSampleRate: null, durationMs: null }
  } finally {
    await audioContext.close().catch(() => undefined)
  }
}

export function StudioPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [studioState, setStudioState] = useState<StudioState>({ phase: 'loading' })
  const [guideState, setGuideState] = useState<GuideState>({
    phase: 'loading',
    guide: null,
  })
  const [guideFile, setGuideFile] = useState<File | null>(null)
  const [guideUploadState, setGuideUploadState] = useState<ActionState>({ phase: 'idle' })
  const [permissionState, setPermissionState] = useState<PermissionState>({ phase: 'idle' })
  const [deviceProfileState, setDeviceProfileState] = useState<DeviceProfileState>({
    phase: 'loading',
    profile: null,
  })
  const [saveDeviceState, setSaveDeviceState] = useState<ActionState>({ phase: 'idle' })
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([])
  const [selectedInputId, setSelectedInputId] = useState('')
  const [outputRoute, setOutputRoute] = useState('headphones')
  const [constraintDraft, setConstraintDraft] =
    useState<ConstraintDraft>(defaultConstraintDraft)
  const [appliedSettingsPreview, setAppliedSettingsPreview] =
    useState<Record<string, unknown> | null>(null)
  const guideFileInputRef = useRef<HTMLInputElement | null>(null)

  function hydrateDeviceDraft(profile: DeviceProfile): void {
    setOutputRoute(profile.output_route)

    const requestedAudio = getRequestedAudioConstraints(profile)
    if (!requestedAudio) {
      return
    }

    setConstraintDraft({
      echoCancellation:
        typeof requestedAudio.echoCancellation === 'boolean'
          ? requestedAudio.echoCancellation
          : defaultConstraintDraft.echoCancellation,
      autoGainControl:
        typeof requestedAudio.autoGainControl === 'boolean'
          ? requestedAudio.autoGainControl
          : defaultConstraintDraft.autoGainControl,
      noiseSuppression:
        typeof requestedAudio.noiseSuppression === 'boolean'
          ? requestedAudio.noiseSuppression
          : defaultConstraintDraft.noiseSuppression,
      channelCount:
        typeof requestedAudio.channelCount === 'number'
          ? requestedAudio.channelCount
          : defaultConstraintDraft.channelCount,
    })
  }

  async function refreshAudioInputs(preferredDeviceId?: string): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      throw new Error('Media device enumeration is not available in this browser.')
    }

    const devices = await navigator.mediaDevices.enumerateDevices()
    const inputs = devices.filter((device) => device.kind === 'audioinput')
    setAudioInputs(inputs)

    setSelectedInputId((current) => {
      if (preferredDeviceId && inputs.some((device) => device.deviceId === preferredDeviceId)) {
        return preferredDeviceId
      }

      if (current && inputs.some((device) => device.deviceId === current)) {
        return current
      }

      return inputs[0]?.deviceId ?? ''
    })
  }

  useEffect(() => {
    if (!projectId) {
      setStudioState({ phase: 'error', message: 'Project id is missing.' })
      return
    }

    const controller = new AbortController()

    async function loadProject(): Promise<void> {
      try {
        const response = await fetch(buildApiUrl(`/api/projects/${projectId}`), {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(
            response.status === 404 ? 'Project was not found.' : `HTTP ${response.status}`,
          )
        }

        const project = (await response.json()) as Project
        setStudioState({ phase: 'ready', project })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setStudioState({
          phase: 'error',
          message: error instanceof Error ? error.message : 'Unable to load the studio.',
        })
      }
    }

    void loadProject()

    return () => controller.abort()
  }, [projectId])

  useEffect(() => {
    if (!projectId) {
      return
    }

    const controller = new AbortController()

    async function loadGuide(): Promise<void> {
      setGuideState({ phase: 'loading', guide: null })

      try {
        const response = await fetch(buildApiUrl(`/api/projects/${projectId}/guide`), {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const payload = (await response.json()) as GuideLookupResponse
        setGuideState({ phase: 'ready', guide: payload.guide })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setGuideState({
          phase: 'error',
          guide: null,
          message:
            error instanceof Error ? error.message : 'Unable to load guide information.',
        })
      }
    }

    void loadGuide()

    return () => controller.abort()
  }, [projectId])

  useEffect(() => {
    const controller = new AbortController()

    async function loadLatestProfile(): Promise<void> {
      setDeviceProfileState({ phase: 'loading', profile: null })

      try {
        const response = await fetch(buildApiUrl('/api/device-profiles?limit=1'), {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const payload = (await response.json()) as DeviceProfileListResponse
        const latestProfile = payload.items[0] ?? null
        if (latestProfile) {
          hydrateDeviceDraft(latestProfile)
          setAppliedSettingsPreview(latestProfile.applied_settings_json)
        }

        setDeviceProfileState({ phase: 'ready', profile: latestProfile })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setDeviceProfileState({
          phase: 'error',
          profile: null,
          message:
            error instanceof Error ? error.message : 'Unable to load the latest profile.',
        })
      }
    }

    void loadLatestProfile()

    return () => controller.abort()
  }, [])

  useEffect(() => {
    void refreshAudioInputs().catch(() => undefined)
  }, [])

  async function handleRequestMicrophoneAccess(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionState({
        phase: 'error',
        message: 'getUserMedia is not available in this browser.',
      })
      return
    }

    setPermissionState({ phase: 'requesting' })

    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const [track] = permissionStream.getAudioTracks()
      const settings = track?.getSettings() ?? {}
      const serializedSettings = serializeTrackSettings(settings)

      setAppliedSettingsPreview(serializedSettings)
      await refreshAudioInputs(typeof settings.deviceId === 'string' ? settings.deviceId : undefined)

      permissionStream.getTracks().forEach((streamTrack) => streamTrack.stop())

      setPermissionState({
        phase: 'granted',
        message: 'Microphone access granted. Device labels are now available.',
      })
    } catch (error) {
      setPermissionState({
        phase: 'error',
        message:
          error instanceof Error ? error.message : 'Microphone permission request failed.',
      })
    }
  }

  async function handleSaveDeviceProfile(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      setSaveDeviceState({
        phase: 'error',
        message: 'getUserMedia is not available in this browser.',
      })
      return
    }

    setSaveDeviceState({ phase: 'submitting' })

    const requestedConstraints = {
      audio: {
        echoCancellation: constraintDraft.echoCancellation,
        autoGainControl: constraintDraft.autoGainControl,
        noiseSuppression: constraintDraft.noiseSuppression,
        channelCount: constraintDraft.channelCount,
        ...(selectedInputId ? { deviceId: { exact: selectedInputId } } : {}),
      },
    }

    let captureStream: MediaStream | null = null
    let audioContext: AudioContext | null = null

    try {
      captureStream = await navigator.mediaDevices.getUserMedia(requestedConstraints)
      const track = captureStream.getAudioTracks()[0]
      const settings = track?.getSettings() ?? {}
      const serializedSettings = serializeTrackSettings(settings)
      setAppliedSettingsPreview(serializedSettings)

      audioContext = new AudioContext()
      const deviceHash = await hashValue(
        typeof settings.deviceId === 'string'
          ? settings.deviceId
          : selectedInputId || 'default-input',
      )

      const response = await fetch(buildApiUrl('/api/device-profiles'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          browser: detectBrowserName(navigator.userAgent),
          os: detectOsName(navigator.userAgent),
          input_device_hash: deviceHash,
          output_route: outputRoute,
          requested_constraints: requestedConstraints,
          applied_settings: serializedSettings,
          actual_sample_rate:
            pickNumber(settings.sampleRate) ?? pickNumber(audioContext.sampleRate),
          channel_count: pickNumber(settings.channelCount),
          input_latency_est: getTrackLatency(settings),
          base_latency: pickNumber(audioContext.baseLatency),
          output_latency: getAudioContextOutputLatency(audioContext),
          calibration_method: 'studio-device-panel',
          calibration_confidence: 0.25,
        }),
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'DeviceProfile save failed.'))
      }

      const savedProfile = (await response.json()) as DeviceProfile
      hydrateDeviceDraft(savedProfile)
      setDeviceProfileState({ phase: 'ready', profile: savedProfile })
      setPermissionState({
        phase: 'granted',
        message: 'Microphone settings were captured and saved.',
      })
      setSaveDeviceState({
        phase: 'success',
        message: 'DeviceProfile saved with requested constraints and applied settings.',
      })
    } catch (error) {
      setSaveDeviceState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'DeviceProfile save failed.',
      })
    } finally {
      captureStream?.getTracks().forEach((streamTrack) => streamTrack.stop())
      await audioContext?.close().catch(() => undefined)
      await refreshAudioInputs(selectedInputId || undefined).catch(() => undefined)
    }
  }

  async function handleGuideUpload(): Promise<void> {
    if (!projectId) {
      setGuideUploadState({ phase: 'error', message: 'Project id is missing.' })
      return
    }

    if (!guideFile) {
      setGuideUploadState({ phase: 'error', message: 'Pick a guide audio file first.' })
      return
    }

    setGuideUploadState({ phase: 'submitting' })

    try {
      const initResponse = await fetch(buildApiUrl(`/api/projects/${projectId}/guide/upload-url`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: guideFile.name,
          content_type: guideFile.type || null,
        }),
      })

      if (!initResponse.ok) {
        throw new Error(await readErrorMessage(initResponse, 'Guide upload could not start.'))
      }

      const uploadSession = (await initResponse.json()) as GuideUploadInitResponse
      const uploadResponse = await fetch(uploadSession.upload_url, {
        method: uploadSession.method,
        headers: guideFile.type
          ? {
              'Content-Type': guideFile.type,
            }
          : undefined,
        body: guideFile,
      })

      if (!uploadResponse.ok) {
        throw new Error(await readErrorMessage(uploadResponse, 'Guide file upload failed.'))
      }

      const metadata = await extractAudioFileMetadata(guideFile)
      const completeResponse = await fetch(buildApiUrl(`/api/projects/${projectId}/guide/complete`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          track_id: uploadSession.track_id,
          source_format: guideFile.type || null,
          duration_ms: metadata.durationMs,
          actual_sample_rate: metadata.actualSampleRate,
        }),
      })

      if (!completeResponse.ok) {
        throw new Error(
          await readErrorMessage(completeResponse, 'Guide track could not be finalized.'),
        )
      }

      const guide = (await completeResponse.json()) as GuideTrack
      setGuideState({ phase: 'ready', guide })
      setGuideUploadState({
        phase: 'success',
        message: 'Guide uploaded, finalized, and attached to this project.',
      })
      setGuideFile(null)
      if (guideFileInputRef.current) {
        guideFileInputRef.current.value = ''
      }
    } catch (error) {
      setGuideUploadState({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Guide upload failed.',
      })
    }
  }

  if (studioState.phase === 'loading') {
    return (
      <div className="page-shell">
        <section className="panel studio-panel">
          <p className="eyebrow">Studio</p>
          <h1>Loading project</h1>
          <p className="panel__summary">
            Pulling the project foundation state before the recording workflow opens.
          </p>
        </section>
      </div>
    )
  }

  if (studioState.phase === 'error') {
    return (
      <div className="page-shell">
        <section className="panel studio-panel">
          <p className="eyebrow">Studio</p>
          <h1>Studio unavailable</h1>
          <p className="form-error">{studioState.message}</p>
          <Link className="back-link" to="/">
            Back to projects
          </Link>
        </section>
      </div>
    )
  }

  const { project } = studioState
  const latestProfile = deviceProfileState.profile
  const guide = guideState.guide
  const inputSelectionDisabled =
    permissionState.phase === 'requesting' || saveDeviceState.phase === 'submitting'

  return (
    <div className="page-shell">
      <section className="panel studio-panel">
        <div className="studio-header">
          <div>
            <p className="eyebrow">Studio Foundation</p>
            <h1>{project.title}</h1>
            <p className="panel__summary">
              This studio entry follows the PROJECT_FOUNDATION sequence: attach a guide,
              capture real microphone settings, then move into recording-ready flows.
            </p>
          </div>

          <Link className="back-link" to="/">
            Create another project
          </Link>
        </div>

        <div className="meta-grid">
          <article className="info-card">
            <h3>Project metadata</h3>
            <dl className="studio-meta">
              <div>
                <dt>ID</dt>
                <dd>{project.project_id}</dd>
              </div>
              <div>
                <dt>BPM</dt>
                <dd>{project.bpm ?? 'Unset'}</dd>
              </div>
              <div>
                <dt>Base key</dt>
                <dd>{project.base_key ?? 'Unset'}</dd>
              </div>
              <div>
                <dt>Time signature</dt>
                <dd>{project.time_signature ?? 'Unset'}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{project.mode ?? 'practice'}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDate(project.created_at)}</dd>
              </div>
            </dl>
          </article>

          <article className="info-card">
            <h3>Current lane tickets</h3>
            <ul>
              {currentLaneTickets.map((ticket) => (
                <li key={ticket}>{ticket}</li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <p className="eyebrow">FE-02 and FE-03</p>
          <h2>Audio setup and guide connection</h2>
        </div>

        <div className="card-grid studio-work-grid">
          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Device Panel</p>
                <h2>Request mic access and save a DeviceProfile</h2>
              </div>
              <span
                className={`status-pill ${
                  permissionState.phase === 'granted'
                    ? 'status-pill--ready'
                    : permissionState.phase === 'error'
                      ? 'status-pill--error'
                      : 'status-pill--loading'
                }`}
              >
                {permissionState.phase === 'granted'
                  ? 'Mic ready'
                  : permissionState.phase === 'error'
                    ? 'Mic blocked'
                    : permissionState.phase === 'requesting'
                      ? 'Requesting'
                      : 'Mic not requested'}
              </span>
            </div>

            <p className="panel__summary">
              Foundation rule: store the requested constraints and the real
              <code>getSettings()</code> result so later scoring work can explain device
              behavior instead of guessing it.
            </p>

            <div className="button-row">
              <button
                className="button-primary"
                type="button"
                disabled={permissionState.phase === 'requesting'}
                onClick={() => void handleRequestMicrophoneAccess()}
              >
                {permissionState.phase === 'requesting'
                  ? 'Requesting access...'
                  : 'Request microphone access'}
              </button>

              <button
                className="button-secondary"
                type="button"
                onClick={() => void refreshAudioInputs().catch(() => undefined)}
              >
                Refresh input list
              </button>
            </div>

            {permissionState.phase === 'granted' || permissionState.phase === 'error' ? (
              <p
                className={
                  permissionState.phase === 'error' ? 'form-error' : 'status-card__hint'
                }
              >
                {permissionState.message}
              </p>
            ) : (
              <p className="status-card__hint">
                Grant access once so browser labels and live settings become visible.
              </p>
            )}

            <div className="field-grid">
              <label className="field">
                <span>Input device</span>
                <select
                  className="text-input"
                  value={selectedInputId}
                  disabled={inputSelectionDisabled || audioInputs.length === 0}
                  onChange={(event) => setSelectedInputId(event.target.value)}
                >
                  {audioInputs.length === 0 ? (
                    <option value="">No microphone detected yet</option>
                  ) : null}
                  {audioInputs.map((device, index) => (
                    <option key={device.deviceId || `audio-input-${index}`} value={device.deviceId}>
                      {device.label || `Microphone ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Output route</span>
                <select
                  className="text-input"
                  value={outputRoute}
                  onChange={(event) => setOutputRoute(event.target.value)}
                >
                  {outputRouteOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="toggle-grid">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={constraintDraft.echoCancellation}
                  onChange={(event) =>
                    setConstraintDraft((current) => ({
                      ...current,
                      echoCancellation: event.target.checked,
                    }))
                  }
                />
                <div>
                  <strong>echoCancellation</strong>
                  <span>Request browser echo control and capture what actually applies.</span>
                </div>
              </label>

              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={constraintDraft.autoGainControl}
                  onChange={(event) =>
                    setConstraintDraft((current) => ({
                      ...current,
                      autoGainControl: event.target.checked,
                    }))
                  }
                />
                <div>
                  <strong>autoGainControl</strong>
                  <span>Keep AGC visible so later pitch scoring can account for device behavior.</span>
                </div>
              </label>

              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={constraintDraft.noiseSuppression}
                  onChange={(event) =>
                    setConstraintDraft((current) => ({
                      ...current,
                      noiseSuppression: event.target.checked,
                    }))
                  }
                />
                <div>
                  <strong>noiseSuppression</strong>
                  <span>Track whether vocal input is being denoised by the browser stack.</span>
                </div>
              </label>
            </div>

            <label className="field field--compact">
              <span>Requested channel count</span>
              <input
                className="text-input"
                type="number"
                min={1}
                max={2}
                value={constraintDraft.channelCount}
                onChange={(event) =>
                  setConstraintDraft((current) => ({
                    ...current,
                    channelCount: Math.max(1, Number(event.target.value) || 1),
                  }))
                }
              />
            </label>

            <div className="button-row">
              <button
                className="button-primary"
                type="button"
                disabled={saveDeviceState.phase === 'submitting'}
                onClick={() => void handleSaveDeviceProfile()}
              >
                {saveDeviceState.phase === 'submitting'
                  ? 'Saving profile...'
                  : 'Save DeviceProfile'}
              </button>
            </div>

            {saveDeviceState.phase === 'success' || saveDeviceState.phase === 'error' ? (
              <p
                className={
                  saveDeviceState.phase === 'error' ? 'form-error' : 'status-card__hint'
                }
              >
                {saveDeviceState.message}
              </p>
            ) : null}

            <div className="json-grid">
              <div>
                <p className="json-label">Requested constraints</p>
                <pre className="json-card">
                  {toPrettyJson({
                    audio: {
                      echoCancellation: constraintDraft.echoCancellation,
                      autoGainControl: constraintDraft.autoGainControl,
                      noiseSuppression: constraintDraft.noiseSuppression,
                      channelCount: constraintDraft.channelCount,
                      ...(selectedInputId ? { deviceId: { exact: selectedInputId } } : {}),
                    },
                  })}
                </pre>
              </div>

              <div>
                <p className="json-label">Latest getSettings() snapshot</p>
                <pre className="json-card">{toPrettyJson(appliedSettingsPreview)}</pre>
              </div>
            </div>

            <div className="mini-grid">
              <div className="mini-card">
                <span>Latest profile</span>
                <strong>
                  {deviceProfileState.phase === 'loading'
                    ? 'Loading...'
                    : latestProfile
                      ? formatDate(latestProfile.updated_at)
                      : 'No saved profile yet'}
                </strong>
              </div>
              <div className="mini-card">
                <span>Actual sample rate</span>
                <strong>{latestProfile?.actual_sample_rate ?? 'Unknown'}</strong>
              </div>
              <div className="mini-card">
                <span>Channel count</span>
                <strong>{latestProfile?.channel_count ?? 'Unknown'}</strong>
              </div>
              <div className="mini-card">
                <span>Output route</span>
                <strong>{latestProfile?.output_route ?? outputRoute}</strong>
              </div>
            </div>

            {deviceProfileState.phase === 'error' ? (
              <p className="form-error">{deviceProfileState.message}</p>
            ) : null}

            {latestProfile ? (
              <div className="support-stack">
                <p className="json-label">Saved applied settings</p>
                <pre className="json-card">
                  {toPrettyJson(latestProfile.applied_settings_json)}
                </pre>
              </div>
            ) : null}
          </article>

          <article className="panel studio-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Guide Track</p>
                <h2>Upload one guide and keep it playable</h2>
              </div>
              <span
                className={`status-pill ${
                  guide
                    ? 'status-pill--ready'
                    : guideState.phase === 'error'
                      ? 'status-pill--error'
                      : 'status-pill--loading'
                }`}
              >
                {guide
                  ? 'Guide connected'
                  : guideState.phase === 'error'
                    ? 'Guide error'
                    : 'Guide pending'}
              </span>
            </div>

            <p className="panel__summary">
              The backend upload lifecycle for SC-03 and BE-02 is active here:
              initialize track, upload bytes, finalize, then expose the latest guide for
              playback.
            </p>

            <label className="field">
              <span>Guide audio file</span>
              <input
                ref={guideFileInputRef}
                className="text-input"
                type="file"
                accept="audio/*"
                onChange={(event) => setGuideFile(event.target.files?.[0] ?? null)}
              />
            </label>

            {guideFile ? (
              <p className="status-card__hint">
                Ready to upload: {guideFile.name} ({Math.round(guideFile.size / 1024)} KB)
              </p>
            ) : (
              <p className="status-card__hint">
                Pick a guide file to create the first source track for this project.
              </p>
            )}

            <div className="button-row">
              <button
                className="button-primary"
                type="button"
                disabled={guideUploadState.phase === 'submitting' || guideFile === null}
                onClick={() => void handleGuideUpload()}
              >
                {guideUploadState.phase === 'submitting'
                  ? 'Uploading guide...'
                  : 'Upload guide'}
              </button>
            </div>

            {guideUploadState.phase === 'success' || guideUploadState.phase === 'error' ? (
              <p
                className={
                  guideUploadState.phase === 'error' ? 'form-error' : 'status-card__hint'
                }
              >
                {guideUploadState.message}
              </p>
            ) : null}

            {guideState.phase === 'error' ? <p className="form-error">{guideState.message}</p> : null}

            {guide ? (
              <div className="support-stack">
                <div className="mini-grid">
                  <div className="mini-card">
                    <span>Status</span>
                    <strong>{guide.track_status}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Format</span>
                    <strong>{guide.source_format ?? 'Unknown'}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Duration</span>
                    <strong>{formatDuration(guide.duration_ms)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Sample rate</span>
                    <strong>{guide.actual_sample_rate ?? 'Unknown'}</strong>
                  </div>
                </div>

                <div className="mini-card mini-card--stack">
                  <span>Storage key</span>
                  <strong>{guide.storage_key ?? 'Not set'}</strong>
                </div>

                <div className="mini-card mini-card--stack">
                  <span>Checksum</span>
                  <strong>{guide.checksum ?? 'Not available'}</strong>
                </div>

                {guide.source_artifact_url ? (
                  <div className="audio-preview">
                    <p className="json-label">Guide playback</p>
                    <audio controls preload="metadata" src={guide.source_artifact_url}>
                      Your browser does not support guide playback.
                    </audio>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-card">
                <p>No guide has been attached to this project yet.</p>
                <p>The next ticket after this will add metronome and count-in controls.</p>
              </div>
            )}
          </article>
        </div>
      </section>
    </div>
  )
}
