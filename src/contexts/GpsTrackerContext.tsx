'use client'

import { createContext, useContext, useState } from 'react'
import { useGpsTracker, type GpsTrackerValue } from '@/hooks/useGpsTracker'
import { GpsStatusBar } from '@/components/admin/GpsStatusBar'
import { GpsClockBar } from '@/components/admin/GpsClockBar'

export interface GpsFullContextValue extends GpsTrackerValue {
  consentGiven: boolean
  grantConsent: () => void
  gpsEnabled: boolean
}

const GpsTrackerContext = createContext<GpsFullContextValue | null>(null)

export function GpsTrackerProvider({
  gpsEnabled,
  children,
}: {
  gpsEnabled: boolean
  children: React.ReactNode
}) {
  const [consentGiven, setConsentGiven] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('gps_consent_given') === 'true'
  })

  const tracker = useGpsTracker({ enabled: gpsEnabled && consentGiven })

  function grantConsent() {
    try {
      localStorage.setItem('gps_consent_given', 'true')
    } catch {}
    setConsentGiven(true)
  }

  const contextValue: GpsFullContextValue = {
    ...tracker,
    consentGiven,
    grantConsent,
    gpsEnabled,
  }

  return (
    <GpsTrackerContext.Provider value={contextValue}>
      {children}
      {gpsEnabled && <GpsStatusBar />}
      {/* GpsClockBar is desktop-only (sm+); mobile uses the nav tab */}
      {gpsEnabled && <GpsClockBar />}
    </GpsTrackerContext.Provider>
  )
}

export function useGpsContext(): GpsFullContextValue {
  const ctx = useContext(GpsTrackerContext)
  if (!ctx) {
    throw new Error('useGpsContext must be used within GpsTrackerProvider')
  }
  return ctx
}

/** Safe to call outside the provider — returns null if no GPS context. */
export function useGpsContextOptional(): GpsFullContextValue | null {
  return useContext(GpsTrackerContext)
}
