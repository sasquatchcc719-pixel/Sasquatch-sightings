'use client'

import { useEffect, useRef, useState } from 'react'
import { BellRing, CheckCircle2, Smartphone } from 'lucide-react'

type PushStatus =
  | 'loading'
  | 'install'
  | 'prompt'
  | 'enabling'
  | 'enabled'
  | 'denied'
  | 'unsupported'
  | 'error'

type PushSubscriptionChange = {
  current: { optedIn: boolean }
}

type OneSignalSdk = {
  init: (config: {
    appId: string
    allowLocalhostAsSecureOrigin: boolean
    serviceWorkerPath: string
  }) => Promise<void>
  login: (externalId: string) => Promise<void>
  Notifications: {
    isPushSupported: () => Promise<boolean>
    permission: boolean
    requestPermission: () => Promise<void>
  }
  User: {
    PushSubscription: {
      optedIn: boolean
      optIn: () => Promise<void>
      addEventListener: (
        event: 'change',
        listener: (change: PushSubscriptionChange) => void,
      ) => void
      removeEventListener: (
        event: 'change',
        listener: (change: PushSubscriptionChange) => void,
      ) => void
    }
  }
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(window.navigator.userAgent)
}

function isStandalone(): boolean {
  return (
    ('standalone' in window.navigator &&
      (window.navigator as Navigator & { standalone?: boolean }).standalone ===
        true) ||
    window.matchMedia('(display-mode: standalone)').matches
  )
}

export function SquarePaymentPushSetup({
  appId,
  externalId,
}: {
  appId: string
  externalId: string
}) {
  const [status, setStatus] = useState<PushStatus>('loading')
  const sdkRef = useRef<OneSignalSdk | null>(null)

  useEffect(() => {
    const allowedDomains = [
      'sightings.sasquatchcarpet.com',
      'sasquatchcarpet.com',
      'localhost',
    ]
    if (!allowedDomains.includes(window.location.hostname)) return

    if (isIOS() && !isStandalone()) {
      const installStatusTimer = window.setTimeout(
        () => setStatus('install'),
        0,
      )
      return () => window.clearTimeout(installStatusTimer)
    }

    let cancelled = false
    let removeSubscriptionListener: (() => void) | undefined

    const setup = async (oneSignal: unknown) => {
      const sdk = oneSignal as OneSignalSdk
      try {
        try {
          await sdk.init({
            appId,
            allowLocalhostAsSecureOrigin: true,
            serviceWorkerPath: '/OneSignalSDKWorker.js',
          })
        } catch {
          // Client-side navigation can encounter an SDK initialized on another page.
        }
        await sdk.login(externalId)
        if (cancelled) return

        sdkRef.current = sdk
        if (!(await sdk.Notifications.isPushSupported())) {
          setStatus('unsupported')
          return
        }

        const onSubscriptionChange = (change: PushSubscriptionChange) => {
          setStatus(change.current.optedIn ? 'enabled' : 'prompt')
        }
        sdk.User.PushSubscription.addEventListener(
          'change',
          onSubscriptionChange,
        )
        removeSubscriptionListener = () =>
          sdk.User.PushSubscription.removeEventListener(
            'change',
            onSubscriptionChange,
          )

        if (sdk.User.PushSubscription.optedIn) {
          setStatus('enabled')
        } else if (
          'Notification' in window &&
          window.Notification.permission === 'denied'
        ) {
          setStatus('denied')
        } else {
          setStatus('prompt')
        }
      } catch {
        if (!cancelled) setStatus('error')
      }
    }

    window.OneSignalDeferred = window.OneSignalDeferred || []
    window.OneSignalDeferred.push(setup)

    if (!document.querySelector('script[src*="OneSignalSDK"]')) {
      const script = document.createElement('script')
      script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js'
      script.async = true
      script.onerror = () => {
        if (!cancelled) setStatus('error')
      }
      document.head.appendChild(script)
    }

    return () => {
      cancelled = true
      removeSubscriptionListener?.()
    }
  }, [appId, externalId])

  const enablePush = async () => {
    const sdk = sdkRef.current
    if (!sdk) {
      setStatus('error')
      return
    }

    setStatus('enabling')
    try {
      await sdk.login(externalId)
      if (!sdk.Notifications.permission) {
        await sdk.Notifications.requestPermission()
      }
      if (!sdk.Notifications.permission) {
        setStatus('denied')
        return
      }
      await sdk.User.PushSubscription.optIn()
      setStatus(sdk.User.PushSubscription.optedIn ? 'enabled' : 'prompt')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'loading') return null

  if (status === 'install') {
    return (
      <section className="mb-5 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-amber-50">
        <div className="flex items-start gap-3">
          <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <div>
            <p className="font-semibold">
              Install Sightings for payment alerts
            </p>
            <p className="mt-1 text-sm text-amber-100/80">
              In Safari, tap Share, choose Add to Home Screen, then open
              Sightings from its new icon. The notification button will appear
              there.
            </p>
          </div>
        </div>
      </section>
    )
  }

  if (status === 'enabled') {
    return (
      <section className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-emerald-50">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" />
        <div>
          <p className="font-semibold">Square payment alerts are enabled</p>
          <p className="text-sm text-emerald-100/70">
            This phone will receive a Sightings alert when a Square invoice is
            paid.
          </p>
        </div>
      </section>
    )
  }

  const unavailable =
    status === 'denied' || status === 'unsupported' || status === 'error'

  return (
    <section className="mb-5 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-amber-50">
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Square payment alerts</p>
          <p className="mt-1 text-sm text-amber-100/80">
            {status === 'denied'
              ? 'Notifications are blocked. Allow Sightings in this phone’s notification settings, then reopen the app.'
              : status === 'unsupported'
                ? 'This browser cannot receive web push notifications.'
                : status === 'error'
                  ? 'Sightings could not start notifications. Reload the app and try again.'
                  : 'Enable alerts on this work phone when a customer pays a Square invoice.'}
          </p>
        </div>
        {!unavailable ? (
          <button
            type="button"
            onClick={() => void enablePush()}
            disabled={status === 'enabling'}
            className="shrink-0 rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:opacity-60"
          >
            {status === 'enabling' ? 'Enabling…' : 'Enable'}
          </button>
        ) : null}
      </div>
    </section>
  )
}
