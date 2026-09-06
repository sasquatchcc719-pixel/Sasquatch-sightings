'use client'

import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

const DISMISSED_KEY = 'push_banner_dismissed'

interface PushOptInBannerProps {
  /** Value proposition shown in the banner. Customize per page. */
  headline?: string
  subline?: string
  /** Keep the NFC card's main actions clear; other pages retain the floating banner. */
  placement?: 'floating' | 'inline'
}

export function PushOptInBanner({
  headline = 'Get exclusive deals & promos',
  subline = 'Tap Allow for occasional notifications — we promise not to spam.',
  placement = 'floating',
}: PushOptInBannerProps) {
  const [visible, setVisible] = useState(false)
  const [subscribed, setSubscribed] = useState(false)

  useEffect(() => {
    // Only show on production
    const allowed = ['sightings.sasquatchcarpet.com', 'sasquatchcarpet.com']
    const isProduction = allowed.some(
      (d) =>
        window.location.hostname === d ||
        window.location.hostname === `www.${d}`,
    )
    if (!isProduction) return

    // Already dismissed
    if (localStorage.getItem(DISMISSED_KEY)) return

    // Wait for OneSignal to be ready, then check subscription status
    const check = () => {
      const os = (
        window as unknown as {
          OneSignal?: { Notifications?: { permission: boolean } }
        }
      ).OneSignal
      if (!os?.Notifications) {
        setTimeout(check, 500)
        return
      }
      if (os.Notifications.permission) {
        // Already subscribed — don't bother
        setSubscribed(true)
        return
      }
      // Show after a short delay so the page has time to render
      setTimeout(() => setVisible(true), 2500)
    }
    check()
  }, [])

  const handleAllow = async () => {
    try {
      const os = (
        window as unknown as {
          OneSignal?: {
            Notifications?: { requestPermission: () => Promise<void> }
          }
        }
      ).OneSignal
      await os?.Notifications?.requestPermission()
    } catch {
      // Permission denied — that's fine
    } finally {
      setVisible(false)
      localStorage.setItem(DISMISSED_KEY, '1')
    }
  }

  const handleDismiss = () => {
    setVisible(false)
    localStorage.setItem(DISMISSED_KEY, '1')
  }

  if (!visible || subscribed) return null

  return (
    <div
      className={
        placement === 'inline'
          ? 'relative my-6 w-full'
          : 'animate-in slide-in-from-bottom-4 fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 duration-300'
      }
    >
      <div className="flex items-start gap-3 rounded-2xl border border-white/20 bg-black/90 px-4 py-4 shadow-2xl backdrop-blur-md">
        {/* Icon */}
        <div
          className={
            placement === 'inline'
              ? 'hidden'
              : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-600'
          }
        >
          <Bell className="h-5 w-5 text-white" />
        </div>

        {/* Text */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white">{headline}</p>
          <p className="mt-0.5 text-xs text-white/70">{subline}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={handleAllow}
              className={
                placement === 'inline'
                  ? 'min-h-11 bg-green-700 px-4 text-xs font-semibold hover:bg-green-800'
                  : 'h-8 bg-green-600 px-4 text-xs font-semibold hover:bg-green-700'
              }
            >
              Allow Notifications
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              className={
                placement === 'inline'
                  ? 'min-h-11 px-3 text-xs text-white/75 hover:text-white'
                  : 'h-8 px-3 text-xs text-white/60 hover:text-white'
              }
            >
              No thanks
            </Button>
          </div>
        </div>

        {/* Close */}
        <button
          onClick={handleDismiss}
          className={
            placement === 'inline'
              ? 'flex min-h-11 min-w-11 items-center justify-center text-white/60 hover:text-white'
              : 'text-white/40 hover:text-white/80'
          }
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
