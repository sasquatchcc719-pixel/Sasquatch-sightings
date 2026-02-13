'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import {
  PartnerLandingLayout,
  PartnerInfo,
  PartnerStats,
} from '@/components/partners/PartnerLandingLayout'

export default function LocationPartnerPage() {
  const params = useParams()
  const partnerId = params.partnerId as string
  const [tapId, setTapId] = useState<string | null>(null)
  const [partner, setPartner] = useState<PartnerInfo | null>(null)

  // Partner portal state
  const [logoTapCount, setLogoTapCount] = useState(0)
  const [loginModalOpen, setLoginModalOpen] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [partnerStats, setPartnerStats] = useState<PartnerStats | null>(null)
  const tapTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Handle logo tap for Easter egg
  const handleLogoTap = () => {
    setLogoTapCount((prev) => {
      const newCount = prev + 1

      // Reset timer on each tap
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current)
      }

      // Reset count after 3 seconds of no taps
      tapTimerRef.current = setTimeout(() => {
        setLogoTapCount(0)
      }, 3000)

      // Unlock at 5 taps
      if (newCount >= 5) {
        setLoginModalOpen(true)
        return 0
      }

      return newCount
    })
  }

  // Handle partner login
  const handleLoginRequest = async (pin: string) => {
    setLoginError('')
    setIsLoggingIn(true)

    try {
      const response = await fetch('/api/location-partner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId, pin }),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setPartnerStats(data.partner)
        setLoginModalOpen(false)
      } else {
        setLoginError(data.error || 'Invalid PIN')
      }
    } catch (error) {
      console.error('Login error:', error)
      setLoginError('Failed to login')
    } finally {
      setIsLoggingIn(false)
    }
  }

  // Track the tap and get partner info on page load
  useEffect(() => {
    const trackTap = async () => {
      try {
        const response = await fetch('/api/tap/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            partnerId: partnerId,
            action: 'page_view',
          }),
        })
        const data = await response.json()
        if (data.tapId) {
          setTapId(data.tapId)
        }
        if (data.partnerName) {
          setPartner({
            id: partnerId,
            location_name: data.partnerName,
            company_name: data.partnerName,
            location_type: data.locationType || null,
            couponCode: data.couponCode,
          })
        }
      } catch (error) {
        console.error('Failed to track tap:', error)
      }
    }

    if (partnerId) {
      void trackTap()
    }
  }, [partnerId])

  // Track button clicks
  const trackButtonClick = async (buttonType: string) => {
    if (!tapId) return

    try {
      await fetch('/api/tap/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tapId,
          action: 'button_click',
          buttonType,
        }),
      })
    } catch (error) {
      console.error('Failed to track button click:', error)
    }
  }

  return (
    <PartnerLandingLayout
      partner={partner}
      partnerStats={partnerStats}
      onPartnerStatsChange={setPartnerStats}
      onTrackClick={trackButtonClick}
      onLoginRequest={handleLoginRequest}
      loginError={loginError}
      isLoggingIn={isLoggingIn}
      loginModalOpen={loginModalOpen}
      setLoginModalOpen={setLoginModalOpen}
      logoTapCount={logoTapCount}
      onLogoTap={handleLogoTap}
    />
  )
}
