'use client'

import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'

const ONESIGNAL_APP_ID = '2279fd62-e36d-494b-b354-af67f233973b'

type BannerState = 'hidden' | 'add-to-homescreen' | 'enable-push'

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    ('standalone' in window.navigator &&
      (window.navigator as unknown as { standalone: boolean }).standalone) ||
    window.matchMedia('(display-mode: standalone)').matches
  )
}

function isIOS(): boolean {
  if (typeof window === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

export function PushNotificationBanner() {
  const [state, setState] = useState<BannerState>('hidden')
  const [enabling, setEnabling] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem('push_banner_dismissed') === '1') return

    if ('Notification' in window && Notification.permission === 'granted') {
      return
    }

    if (isIOS() && !isStandalone()) {
      setState('add-to-homescreen')
      return
    }

    setState('enable-push')
  }, [])

  const handleEnable = async () => {
    setEnabling(true)
    try {
      if ('Notification' in window) {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          setState('hidden')
          return
        }
      }

      if (!document.querySelector('script[src*="OneSignalSDK"]')) {
        const script = document.createElement('script')
        script.src =
          'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js'
        script.async = true
        document.head.appendChild(script)
        await new Promise<void>((resolve) => {
          script.onload = () => resolve()
          script.onerror = () => resolve()
        })
      }

      window.OneSignalDeferred = window.OneSignalDeferred || []
      window.OneSignalDeferred.push(async (OneSignal: unknown) => {
        const os = OneSignal as {
          init: (config: {
            appId: string
            serviceWorkerPath: string
            allowLocalhostAsSecureOrigin: boolean
          }) => Promise<void>
          Notifications?: {
            requestPermission: () => Promise<void>
          }
        }
        try {
          await os.init({
            appId: ONESIGNAL_APP_ID,
            serviceWorkerPath: '/OneSignalSDKWorker.js',
            allowLocalhostAsSecureOrigin: true,
          })
          if (os.Notifications) {
            await os.Notifications.requestPermission()
          }
        } catch {
          // may throw if already initialized
        }
      })

      setState('hidden')
      localStorage.setItem('push_banner_dismissed', '1')
    } catch {
      setState('hidden')
    } finally {
      setEnabling(false)
    }
  }

  const handleDismiss = () => {
    setState('hidden')
    localStorage.setItem('push_banner_dismissed', '1')
  }

  if (state === 'hidden') return null

  if (state === 'add-to-homescreen') {
    return (
      <div className="relative mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-200 backdrop-blur">
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 text-amber-400/60 hover:text-amber-300"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-start gap-3">
          <Bell className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <p className="font-semibold text-amber-100">
              Get push notifications for new bookings
            </p>
            <ol className="mt-2 space-y-1 text-amber-200/90">
              <li>
                1. Tap the{' '}
                <strong className="text-amber-100">Share button</strong> (square
                with arrow) at the bottom of Safari
              </li>
              <li>
                2. Tap{' '}
                <strong className="text-amber-100">
                  &quot;Add to Home Screen&quot;
                </strong>
              </li>
              <li>3. Open the app from your home screen</li>
              <li>
                4. Tap <strong className="text-amber-100">Enable</strong> on the
                banner that appears
              </li>
            </ol>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative mb-4 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 backdrop-blur">
      <Bell className="h-5 w-5 shrink-0 text-amber-400" />
      <span className="flex-1">
        Enable push notifications so you get alerts when new jobs are booked.
      </span>
      <button
        onClick={() => void handleEnable()}
        disabled={enabling}
        className="shrink-0 rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
      >
        {enabling ? 'Enabling…' : 'Enable'}
      </button>
      <button
        onClick={handleDismiss}
        className="shrink-0 text-amber-400/60 hover:text-amber-300"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
