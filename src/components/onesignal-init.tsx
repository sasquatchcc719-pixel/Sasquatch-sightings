'use client'

import { useEffect } from 'react'

export function OneSignalInit() {
  useEffect(() => {
    // Only initialize on client side
    if (typeof window === 'undefined') return

    // Load OneSignal script
    const script = document.createElement('script')
    script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js'
    script.async = true
    document.head.appendChild(script)

    // Initialize OneSignal when script loads
    script.onload = () => {
      window.OneSignalDeferred = window.OneSignalDeferred || []
      window.OneSignalDeferred.push(async function (OneSignal: any) {
        await OneSignal.init({
          appId: '2279fd62-e36d-494b-b354-af67f233973b',
          allowLocalhostAsSecureOrigin: true,
        })
      })
    }

    return () => {
      // Cleanup
      if (script.parentNode) {
        script.parentNode.removeChild(script)
      }
    }
  }, [])

  return null
}
