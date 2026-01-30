'use client'

import { useEffect } from 'react'

export function OneSignalInit() {
  useEffect(() => {
    // Only initialize on client side
    if (typeof window === 'undefined') return

    // Only initialize OneSignal on the production domain
    // This prevents "Can only be used on: https://sightings.sasquatchcarpet.com" errors
    const allowedDomains = [
      'sightings.sasquatchcarpet.com',
      'sasquatchcarpet.com',
    ]
    const currentDomain = window.location.hostname

    if (!allowedDomains.includes(currentDomain)) {
      console.log(
        `OneSignal skipped: ${currentDomain} is not a production domain`,
      )
      return
    }

    // Check if OneSignal is already loaded
    if (document.querySelector('script[src*="OneSignalSDK"]')) {
      console.log('OneSignal script already loaded')
      return
    }

    // Load OneSignal script
    const script = document.createElement('script')
    script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js'
    script.async = true
    document.head.appendChild(script)

    // Initialize OneSignal when script loads
    script.onload = () => {
      console.log('OneSignal script loaded successfully')
      window.OneSignalDeferred = window.OneSignalDeferred || []
      window.OneSignalDeferred.push(async function (OneSignal: any) {
        try {
          await OneSignal.init({
            appId: '2279fd62-e36d-494b-b354-af67f233973b',
            allowLocalhostAsSecureOrigin: true,
          })
          console.log('OneSignal initialized successfully')
        } catch (error) {
          console.error('OneSignal initialization error:', error)
        }
      })
    }

    script.onerror = () => {
      console.error('Failed to load OneSignal script')
    }

    // Don't remove script on cleanup - it should persist
  }, [])

  return null
}
