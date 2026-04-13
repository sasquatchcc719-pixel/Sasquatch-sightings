'use client'

import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'

const ONESIGNAL_APP_ID = '2279fd62-e36d-494b-b354-af67f233973b'

export function PushNotificationBanner() {
  const [visible, setVisible] = useState(false)
  const [enabling, setEnabling] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('Notification' in window)) return
    if (Notification.permission === 'granted') return
    if (Notification.permission === 'denied') return
    if (localStorage.getItem('push_banner_dismissed') === '1') return
    setVisible(true)
  }, [])

  const handleEnable = async () => {
    setEnabling(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setVisible(false)
        return
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
          // OneSignal init may throw if already initialized
        }
      })

      setVisible(false)
      localStorage.setItem('push_banner_dismissed', '1')
    } catch {
      setVisible(false)
    } finally {
      setEnabling(false)
    }
  }

  const handleDismiss = () => {
    setVisible(false)
    localStorage.setItem('push_banner_dismissed', '1')
  }

  if (!visible) return null

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
