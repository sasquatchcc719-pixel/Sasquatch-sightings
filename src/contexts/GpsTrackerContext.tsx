'use client'

import { createContext, useContext, useState } from 'react'
import { useGpsTracker, type GpsTrackerValue } from '@/hooks/useGpsTracker'
import { GpsStatusBar } from '@/components/admin/GpsStatusBar'
import { GpsClockBar } from '@/components/admin/GpsClockBar'

const GpsTrackerContext = createContext<GpsTrackerValue | null>(null)

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

  function handleConsent() {
    try {
      localStorage.setItem('gps_consent_given', 'true')
    } catch {}
    setConsentGiven(true)
  }

  return (
    <GpsTrackerContext.Provider value={tracker}>
      {children}
      {gpsEnabled && (
        <>
          <GpsStatusBar />
          <GpsClockBar consentGiven={consentGiven} onConsent={handleConsent} />
        </>
      )}
    </GpsTrackerContext.Provider>
  )
}

export function useGpsContext(): GpsTrackerValue {
  const ctx = useContext(GpsTrackerContext)
  if (!ctx) {
    throw new Error('useGpsContext must be used within GpsTrackerProvider')
  }
  return ctx
}
