import { getAudioContextConstructor, getOfflineAudioContextConstructor } from './audioContext'
import { listSupportedRecordingMimeTypes, pickSupportedRecordingMimeType } from './studioAudio'

export type BrowserAudioCapabilitySnapshot = {
  secure_context: boolean
  media_devices: {
    get_user_media: boolean
    enumerate_devices: boolean
    get_supported_constraints: boolean
    supported_constraints: string[]
  }
  permissions: {
    api_supported: boolean
    microphone: 'granted' | 'prompt' | 'denied' | 'unknown'
  }
  web_audio: {
    audio_context: boolean
    audio_context_mode: 'standard' | 'webkit' | 'unavailable'
    audio_worklet?: boolean
    offline_audio_context: boolean
    offline_audio_context_mode: 'standard' | 'webkit' | 'unavailable'
    output_latency_supported: boolean
  }
  execution?: {
    web_assembly: boolean
    web_worker: boolean
  }
  media_recorder: {
    supported: boolean
    supported_mime_types: string[]
    selected_mime_type: string | null
  }
  audio_playback: {
    wav: 'probably' | 'maybe' | 'unsupported'
    webm: 'probably' | 'maybe' | 'unsupported'
    mp4: 'probably' | 'maybe' | 'unsupported'
    ogg: 'probably' | 'maybe' | 'unsupported'
  }
}

type CapabilityCollectionOptions = {
  audioContext?: AudioContext | null
  microphonePermissionState?: 'granted' | 'prompt' | 'denied' | 'unknown' | null
}

function normalizeCanPlayType(value: string): 'probably' | 'maybe' | 'unsupported' {
  if (value === 'probably' || value === 'maybe') {
    return value
  }

  return 'unsupported'
}

async function getMicrophonePermissionState(): Promise<
  'granted' | 'prompt' | 'denied' | 'unknown'
> {
  if (
    typeof navigator === 'undefined' ||
    !('permissions' in navigator) ||
    typeof navigator.permissions?.query !== 'function'
  ) {
    return 'unknown'
  }

  try {
    const status = await navigator.permissions.query({
      name: 'microphone' as PermissionName,
    })
    if (status.state === 'granted' || status.state === 'prompt' || status.state === 'denied') {
      return status.state
    }
  } catch {
    return 'unknown'
  }

  return 'unknown'
}

export async function collectBrowserAudioCapabilities(
  options: CapabilityCollectionOptions = {},
): Promise<BrowserAudioCapabilitySnapshot> {
  const audioContextCtor = typeof window === 'undefined' ? undefined : getAudioContextConstructor(window)
  const offlineAudioContextCtor =
    typeof window === 'undefined' ? undefined : getOfflineAudioContextConstructor(window)
  const microphonePermission =
    options.microphonePermissionState ?? (await getMicrophonePermissionState())
  const supportedConstraints =
    navigator.mediaDevices?.getSupportedConstraints?.() ?? ({} as MediaTrackSupportedConstraints)
  const playbackProbe = document.createElement('audio')
  const supportedRecordingMimeTypes = listSupportedRecordingMimeTypes()
  const selectedRecordingMimeType = pickSupportedRecordingMimeType() ?? null
  const liveAudioContext = options.audioContext ?? null

  return {
    secure_context: typeof window !== 'undefined' ? window.isSecureContext : false,
    media_devices: {
      get_user_media: typeof navigator.mediaDevices?.getUserMedia === 'function',
      enumerate_devices: typeof navigator.mediaDevices?.enumerateDevices === 'function',
      get_supported_constraints: typeof navigator.mediaDevices?.getSupportedConstraints === 'function',
      supported_constraints: Object.entries(supportedConstraints)
        .filter(([, supported]) => supported)
        .map(([key]) => key)
        .sort(),
    },
    permissions: {
      api_supported:
        typeof navigator !== 'undefined' &&
        'permissions' in navigator &&
        typeof navigator.permissions?.query === 'function',
      microphone: microphonePermission,
    },
    web_audio: {
      audio_context: typeof audioContextCtor !== 'undefined',
      audio_context_mode:
        typeof window !== 'undefined' && window.AudioContext
          ? 'standard'
          : typeof audioContextCtor !== 'undefined'
            ? 'webkit'
            : 'unavailable',
      audio_worklet:
        typeof audioContextCtor !== 'undefined' &&
        typeof AudioWorkletNode !== 'undefined' &&
        'audioWorklet' in audioContextCtor.prototype,
      offline_audio_context: typeof offlineAudioContextCtor !== 'undefined',
      offline_audio_context_mode:
        typeof window !== 'undefined' && window.OfflineAudioContext
          ? 'standard'
          : typeof offlineAudioContextCtor !== 'undefined'
            ? 'webkit'
            : 'unavailable',
      output_latency_supported:
        liveAudioContext !== null &&
        ('outputLatency' in liveAudioContext ||
          typeof (liveAudioContext as AudioContext & { outputLatency?: number }).outputLatency !==
            'undefined'),
    },
    execution: {
      web_assembly: typeof WebAssembly !== 'undefined',
      web_worker: typeof Worker !== 'undefined',
    },
    media_recorder: {
      supported: typeof MediaRecorder !== 'undefined',
      supported_mime_types: supportedRecordingMimeTypes,
      selected_mime_type: selectedRecordingMimeType,
    },
    audio_playback: {
      wav: normalizeCanPlayType(playbackProbe.canPlayType('audio/wav')),
      webm: normalizeCanPlayType(playbackProbe.canPlayType('audio/webm')),
      mp4: normalizeCanPlayType(playbackProbe.canPlayType('audio/mp4')),
      ogg: normalizeCanPlayType(playbackProbe.canPlayType('audio/ogg')),
    },
  }
}

export function deriveBrowserAudioWarningFlags(
  snapshot: BrowserAudioCapabilitySnapshot,
): string[] {
  const flags: string[] = []

  if (!snapshot.secure_context) {
    flags.push('insecure_context')
  }
  if (!snapshot.media_devices.get_user_media) {
    flags.push('missing_get_user_media')
  }
  if (!snapshot.media_devices.enumerate_devices) {
    flags.push('missing_enumerate_devices')
  }
  if (!snapshot.media_devices.get_supported_constraints) {
    flags.push('missing_supported_constraints')
  }
  if (!snapshot.permissions.api_supported) {
    flags.push('permissions_api_unavailable')
  }
  if (snapshot.permissions.microphone === 'denied') {
    flags.push('microphone_permission_denied')
  }
  if (!snapshot.web_audio.audio_context) {
    flags.push('missing_audio_context')
  }
  if (snapshot.web_audio.audio_context_mode === 'webkit') {
    flags.push('legacy_webkit_audio_context_only')
  }
  if (!snapshot.web_audio.audio_worklet) {
    flags.push('missing_audio_worklet')
  }
  if (!snapshot.web_audio.offline_audio_context) {
    flags.push('missing_offline_audio_context')
  }
  if (!snapshot.web_audio.output_latency_supported) {
    flags.push('output_latency_unavailable')
  }
  if (!snapshot.execution?.web_worker) {
    flags.push('missing_web_worker')
  }
  if (!snapshot.execution?.web_assembly) {
    flags.push('missing_web_assembly')
  }
  if (!snapshot.media_recorder.supported) {
    flags.push('missing_media_recorder')
  } else if (snapshot.media_recorder.selected_mime_type === null) {
    flags.push('no_supported_recording_mime_type')
  }
  if (snapshot.audio_playback.wav === 'unsupported') {
    flags.push('wav_playback_unavailable')
  }

  return flags
}

export function getBrowserAudioWarningLabel(flag: string): string {
  switch (flag) {
    case 'insecure_context':
      return '보안 연결이 아니어서 마이크나 재생 기능이 제한될 수 있습니다.'
    case 'missing_get_user_media':
      return '현재 브라우저에서는 마이크 입력을 시작할 수 없습니다.'
    case 'missing_enumerate_devices':
      return '오디오 장치 목록을 읽을 수 없습니다.'
    case 'missing_supported_constraints':
      return '브라우저가 세부 입력 설정을 알려주지 않습니다.'
    case 'permissions_api_unavailable':
      return '이 환경에서는 마이크 권한 상태를 미리 확인할 수 없습니다.'
    case 'microphone_permission_denied':
      return '현재 마이크 권한이 거부되어 있습니다.'
    case 'missing_audio_context':
      return '브라우저 재생 기능을 사용할 수 없습니다.'
    case 'legacy_webkit_audio_context_only':
      return '이 브라우저는 구형 재생 경로에 의존합니다.'
    case 'missing_audio_worklet':
      return '실시간 입력 표시가 제한될 수 있습니다.'
    case 'missing_offline_audio_context':
      return '브라우저 안에서 합치기 미리듣기가 제한될 수 있습니다.'
    case 'output_latency_unavailable':
      return '이 경로에서는 출력 지연 시간을 확인할 수 없습니다.'
    case 'missing_web_worker':
      return '미리보기 계산이 느려질 수 있습니다.'
    case 'missing_web_assembly':
      return '브라우저 계산 최적화가 제한됩니다.'
    case 'missing_media_recorder':
      return '브라우저 녹음을 시작할 수 없습니다.'
    case 'no_supported_recording_mime_type':
      return '지원되는 녹음 형식을 찾지 못했습니다.'
    case 'wav_playback_unavailable':
      return 'WAV 재생 지원 여부를 확인하지 못했습니다.'
    default:
      return flag
  }
}
