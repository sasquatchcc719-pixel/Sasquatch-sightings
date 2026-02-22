'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

const ONESIGNAL_APP_ID = '2279fd62-e36d-494b-b354-af67f233973b'
const ALLOWED_DOMAINS = ['sightings.sasquatchcarpet.com', 'sasquatchcarpet.com']

function getPushContext(
  pathname: string,
): { source: string; partner_id?: string } | null {
  if (!pathname) return null
  if (pathname === '/tap' || pathname === '/links') {
    return { source: 'tap' }
  }
  if (pathname.startsWith('/location/')) {
    const parts = pathname.split('/').filter(Boolean)
    const partnerId = parts[1]
    if (pathname.includes('/contest')) {
      return { source: 'contest', partner_id: partnerId }
    }
    return { source: 'vendor', partner_id: partnerId }
  }
  if (pathname === '/sightings') {
    return { source: 'contest' }
  }
  return null
}

/**
 * Loads OneSignal on public entry pages (tap, links, location, contest) and sets
 * tags (source, partner_id) when the user subscribes so we can target push by audience.
 */
export function OneSignalPublicInit() {
  const pathname = usePathname()

  useEffect(() => {
    const context = getPushContext(pathname ?? '')
    if (!context) return

    if (typeof window === 'undefined') return
    const isProduction = ALLOWED_DOMAINS.some(
      (d) =>
        window.location.hostname === d ||
        window.location.hostname === `www.${d}`,
    )
    if (!isProduction) return

    if (document.querySelector('script[src*="OneSignalSDK"]')) {
      window.OneSignalDeferred = window.OneSignalDeferred || []
      window.OneSignalDeferred.push(async (OneSignal: unknown) => {
        const os = OneSignal as {
          User?: { addTagWithKey?: (k: string, v: string) => Promise<void> }
        }
        if (os.User?.addTagWithKey) {
          os.User.addTagWithKey('source', context.source).catch(() => {})
          if (context.partner_id)
            os.User.addTagWithKey('partner_id', context.partner_id).catch(
              () => {},
            )
        }
      })
      return
    }

    const script = document.createElement('script')
    script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js'
    script.async = true
    document.head.appendChild(script)

    script.onload = () => {
      window.OneSignalDeferred = window.OneSignalDeferred || []
      window.OneSignalDeferred.push(async (OneSignal: unknown) => {
        try {
          const os = OneSignal as {
            init: (opts: {
              appId: string
              allowLocalhostAsSecureOrigin: boolean
            }) => Promise<void>
            User?: {
              addTagWithKey?: (key: string, value: string) => Promise<void>
            }
          }
          await os.init({
            appId: ONESIGNAL_APP_ID,
            allowLocalhostAsSecureOrigin: true,
          })
          const trySetTags = () => {
            if (os.User?.addTagWithKey) {
              os.User.addTagWithKey('source', context.source).catch(() => {})
              if (context.partner_id) {
                os.User.addTagWithKey('partner_id', context.partner_id).catch(
                  () => {},
                )
              }
            }
          }
          trySetTags()
          setTimeout(trySetTags, 2000)
        } catch {
          // ignore
        }
      })
    }
  }, [pathname])

  return null
}
