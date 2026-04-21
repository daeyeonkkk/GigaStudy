type BrowserAudioWindow = Window & {
  AudioContext?: typeof AudioContext
  webkitAudioContext?: typeof AudioContext
}

export function getBrowserAudioContextConstructor(): typeof AudioContext | null {
  const browserWindow = window as BrowserAudioWindow
  return browserWindow.AudioContext ?? browserWindow.webkitAudioContext ?? null
}
