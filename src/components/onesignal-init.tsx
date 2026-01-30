'use client'

import { useEffect } from 'react'

export function OneSignalInit() {
  useEffect(() => {
    // Wrap everything in try-catch to prevent any errors from bubbling up
    try {
      // Only initialize on client side
      if (typeof window === 'undefined') return

      // Only initialize OneSignal on the production domain
      // This prevents "Can only be used on: https://sightings.sasquatchcarpet.com" errors
      const allowedDomains = [
        'sightings.sasquatchcarpet.com',
        'sasquatchcarpet.com',
      ]
      const currentDomain = window.location.hostname

      // Strict domain check - skip if not exactly matching production
      const isProductionDomain = allowedDomains.some(
        (domain) =>
          currentDomain === domain || currentDomain === `www.${domain}`,
      )

      if (!isProductionDomain) {
        // Silently skip on non-production (no console log to reduce noise)
        return
      }

      // Check if OneSignal is already loaded
      if (document.querySelector('script[src*="OneSignalSDK"]')) {
        return
      }

      // Load OneSignal script
      const script = document.createElement('script')
      script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js'
      script.async = true
      document.head.appendChild(script)

      // Initialize OneSignal when script loads
      script.onload = () => {
        window.OneSignalDeferred = window.OneSignalDeferred || []
        window.OneSignalDeferred.push(async function (OneSignal: unknown) {
          try {
            const os = OneSignal as {
              init: (config: {
                appId: string
                allowLocalhostAsSecureOrigin: boolean
              }) => Promise<void>
            }
            await os.init({
              appId: '2279fd62-e36d-494b-b354-af67f233973b',
              allowLocalhostAsSecureOrigin: true,
            })
          } catch {
            // Silently fail - OneSignal errors shouldn't break the app
          }
        })
      }

      script.onerror = () => {
        // Silently fail
      }
    } catch {
      // Silently fail - OneSignal should never break the app
    }
  }, [])

  return null
}
