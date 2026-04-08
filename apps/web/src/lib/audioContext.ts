type LegacyAudioWindow = Window &
  typeof globalThis & {
    AudioContext?: typeof AudioContext
    OfflineAudioContext?: typeof OfflineAudioContext
    webkitAudioContext?: typeof AudioContext
    webkitOfflineAudioContext?: typeof OfflineAudioContext
  }

export function getAudioContextConstructor(
  targetWindow: Window = window,
): typeof AudioContext | undefined {
  const audioWindow = targetWindow as LegacyAudioWindow
  return audioWindow.AudioContext ?? audioWindow.webkitAudioContext
}

export function getOfflineAudioContextConstructor(
  targetWindow: Window = window,
): typeof OfflineAudioContext | undefined {
  const audioWindow = targetWindow as LegacyAudioWindow
  return audioWindow.OfflineAudioContext ?? audioWindow.webkitOfflineAudioContext
}
