'use client'

/**
 * Screen Wake Lock — keeps the screen on while GPS tracking is active.
 * https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
 *
 * iOS Safari 16.4+ and modern Android Chrome support this.
 * Gracefully degrades when unsupported.
 */

let wakeLock: WakeLockSentinel | null = null

export async function requestWakeLock(): Promise<void> {
  if (typeof window === 'undefined') return
  if (!('wakeLock' in navigator)) return

  try {
    wakeLock = await navigator.wakeLock.request('screen')
    wakeLock.addEventListener('release', () => {
      wakeLock = null
    })

    // Re-acquire when the page becomes visible again (lock is released on hide)
    document.addEventListener('visibilitychange', reacquireWakeLock, {
      once: false,
    })
  } catch (err) {
    // Not critical — GPS still works, screen may dim
    console.warn('[wake-lock] Could not acquire:', err)
  }
}

async function reacquireWakeLock(): Promise<void> {
  if (document.visibilityState === 'visible' && wakeLock === null) {
    await requestWakeLock()
  }
}

export function releaseWakeLock(): void {
  document.removeEventListener('visibilitychange', reacquireWakeLock)
  if (wakeLock) {
    void wakeLock.release()
    wakeLock = null
  }
}
