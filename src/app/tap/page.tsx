'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import {
  ChevronRight,
  Phone,
  MessageSquare,
  UserPlus,
  Share2,
  Star,
  CalendarCheck,
  MapPin,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { RecentJobsCarousel } from '@/components/nfc/recent-jobs-carousel'
import { NfcBookingWidget } from '@/components/nfc/NfcBookingWidget'
import { VideoBackground } from '@/components/public/VideoBackground'
import { PushOptInBanner } from '@/components/push-opt-in-banner'

export default function TapLandingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const cardId = searchParams.get('card')
  const partnerId = searchParams.get('partner') // For location partners
  const [tapId, setTapId] = useState<string | null>(null)
  const [partnerName, setPartnerName] = useState<string | null>(null)
  const [couponCode, setCouponCode] = useState<string>('SCC20')
  const [showWidget, setShowWidget] = useState(false)
  const [showShareToast, setShowShareToast] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(!!partnerId)

  // Redirect logic moved to trackTap to support placard configuration

  // Track the tap on page load
  useEffect(() => {
    // Track tap and handle redirect

    const trackTap = async () => {
      try {
        const response = await fetch('/api/tap/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cardId: cardId || null,
            partnerId: partnerId || null,
            action: 'page_view',
          }),
        })
        const data = await response.json()
        if (data.tapId) {
          setTapId(data.tapId)
        }
        if (data.partnerName) {
          setPartnerName(data.partnerName)
        }
        if (data.couponCode) {
          setCouponCode(data.couponCode)
        }

        // Handle redirection based on placard type
        if (partnerId) {
          if (data.placardType === 'contest') {
            router.replace(`/location/${partnerId}/contest`)
          } else {
            router.replace(`/location/${partnerId}`)
          }
        }
      } catch (error) {
        console.error('Failed to track tap:', error)
      }
    }

    trackTap()
  }, [cardId, partnerId, isRedirecting, router])

  if (isRedirecting) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-black">
        <div className="text-center text-white">
          <div className="mb-4 animate-bounce text-4xl">🦍</div>
          <p>Loading Vendor Page...</p>
        </div>
      </div>
    )
  }

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

  const handleCall = () => {
    trackButtonClick('call')
    window.location.href = 'tel:719-249-8791'
  }

  const handleText = () => {
    trackButtonClick('text')
    // Pre-populate text with partner info so bot knows the source
    const prefilledMessage = partnerName
      ? `Hi! I scanned the card at ${partnerName} and I'm interested in carpet cleaning.`
      : 'Hi! I scanned your card and I am interested in carpet cleaning.'
    window.location.href = `sms:719-249-8791?body=${encodeURIComponent(prefilledMessage)}`
  }

  const handleSaveContact = () => {
    trackButtonClick('save_contact')
    // Use a real URL so the phone opens "Add to Contact" instead of downloading a .vcf file.
    // Blob URLs are often treated as downloads; serving the vCard from the server with
    // Content-Disposition: inline lets the OS open the contact screen on mobile.
    const url = `/api/sasquatch-contact?code=${encodeURIComponent(couponCode)}`
    window.location.href = url
  }

  const handleShare = async () => {
    trackButtonClick('share')

    const shareUrl = window.location.href
    const shareText = `🦶 Get $20 OFF carpet cleaning from Sasquatch! Use code ${couponCode} when booking. Colorado Springs area.`

    // Check if native share is available (mobile)
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Sasquatch Carpet Cleaning - $20 OFF',
          text: shareText,
          url: shareUrl,
        })
      } catch (error) {
        // User cancelled share, that's okay
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Share failed:', error)
          // Fallback to copy
          copyToClipboard(shareUrl)
        }
      }
    } else {
      // Desktop: Copy to clipboard
      copyToClipboard(shareUrl)
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setShowShareToast(true)
      setTimeout(() => setShowShareToast(false), 3000)
    } catch (error) {
      console.error('Failed to copy:', error)
      alert('Link: ' + text)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <VideoBackground video="clouds" />

      {/* Hero Section */}
      <div className="relative z-10 mx-auto max-w-2xl px-4 py-8">
        {/* Card Image */}
        <div className="mb-6 overflow-hidden rounded-xl shadow-2xl">
          <Image
            src="/nfc-card.png"
            alt="Sasquatch Carpet Cleaning Card"
            width={800}
            height={450}
            className="w-full"
            priority
          />
        </div>

        {/* Action Buttons */}
        <div className="mb-6 space-y-3">
          {/* PRIMARY CTA — Get a Free Estimate (booking widget) */}
          <button
            onClick={() => {
              setShowWidget((v) => !v)
              if (!showWidget) trackButtonClick('booking_widget_open')
            }}
            className="group relative w-full overflow-hidden rounded-2xl shadow-2xl transition-all hover:scale-[1.02]"
          >
            <div className="relative bg-gradient-to-b from-green-400 to-green-600 px-8 py-8 text-center transition-all group-hover:from-green-500 group-hover:to-green-700">
              <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-b from-white/30 to-transparent" />
              <div className="relative">
                <p className="mb-1 text-sm font-semibold tracking-wide text-white/90 uppercase">
                  {showWidget ? 'Hide Estimator' : 'Tap to get prices & book'}
                </p>
                <p className="text-3xl font-black text-white drop-shadow-lg">
                  <CalendarCheck className="mr-2 inline-block h-8 w-8" />
                  {showWidget ? 'Hide Estimator' : 'Get a Free Estimate'}
                </p>
                <p className="mt-1 text-lg font-bold text-white/90">
                  {couponCode} saves you $20 — auto-applied
                </p>
              </div>
              <div className="absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-black/20 to-transparent" />
            </div>
            <div className="absolute inset-0 translate-x-[-100%] bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-[100%]" />
          </button>

          {/* Inline booking widget — expands below the CTA */}
          {showWidget && (
            <NfcBookingWidget
              couponCode={couponCode}
              cardId={cardId}
              onTrackClick={trackButtonClick}
            />
          )}

          {/* Leave Us a Review */}
          <a
            href="https://g.page/r/CVAp5EYpgMFLEBM/review"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackButtonClick('review')}
          >
            <Button
              size="lg"
              variant="outline"
              className="w-full border-2 border-amber-400 py-6 text-lg font-semibold text-amber-400 hover:bg-amber-400/10"
            >
              <Star className="mr-2 h-5 w-5" />
              Leave Us a Review
            </Button>
          </a>

          {/* Call Button */}
          <Button
            onClick={handleCall}
            size="lg"
            className="w-full bg-blue-600 py-6 text-lg font-bold hover:bg-blue-700"
          >
            <Phone className="mr-2 h-5 w-5" />
            Call: 719-249-8791
          </Button>

          {/* Text Button */}
          <Button
            onClick={handleText}
            size="lg"
            variant="outline"
            className="w-full border-2 py-6 text-lg font-semibold"
          >
            <MessageSquare className="mr-2 h-5 w-5" />
            Text Us
          </Button>

          {/* Save Contact */}
          <Button
            onClick={handleSaveContact}
            size="lg"
            variant="outline"
            className="w-full border-2 py-6 text-lg font-semibold"
          >
            <UserPlus className="mr-2 h-5 w-5" />
            Save to Contacts
          </Button>

          {/* Share Button */}
          <Button
            onClick={handleShare}
            size="lg"
            variant="outline"
            className="w-full border-2 border-blue-500 py-6 text-lg font-semibold text-blue-600 hover:bg-blue-50 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-950"
          >
            <Share2 className="mr-2 h-5 w-5" />
            Share This Deal
          </Button>
        </div>

        {/* Location Partner Badge (if applicable) */}
        {partnerName && (
          <Card className="mb-6 border-2 border-amber-500 bg-black/80 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
              <span className="text-xl">🎁</span>
              <span>Found at: {partnerName}</span>
            </div>
            <p className="mt-1 text-xs text-amber-200">
              This location earns rewards for sharing our service!
            </p>
          </Card>
        )}

        {/* Service Areas */}
        <Card className="mb-6 border-white/20 bg-black/80 p-4">
          <div className="flex items-center gap-2 text-sm text-white/80">
            <MapPin className="h-4 w-4" />
            <span className="font-medium">We Serve:</span>
            <span>
              Monument • Colorado Springs • Castle Rock • Black Forest
            </span>
          </div>
        </Card>

        {/* Recommended Contractors */}
        <Card className="mb-6 border-white/20 bg-black/80 p-6">
          <div className="mb-4 flex items-start gap-3">
            <div className="rounded-full bg-green-500/20 p-3 text-green-300">
              <Wrench className="h-6 w-6" />
            </div>
            <div>
              <p className="mb-1 text-sm font-semibold tracking-wide text-green-200 uppercase">
                Local pros we trust
              </p>
              <h3 className="text-xl font-bold text-white">
                What contractors do we recommend?
              </h3>
            </div>
          </div>
          <p className="mb-4 text-sm leading-6 text-white/80">
            Customers ask us for plumbers, carpet repair, electricians, and
            other local pros all the time. We&apos;re building that list in one
            easy place.
          </p>
          <Button
            asChild
            size="lg"
            className="w-full bg-green-600 py-6 text-base font-bold hover:bg-green-700"
          >
            <Link
              href="/recommended-contractors"
              onClick={() => trackButtonClick('recommended_contractors')}
            >
              View Recommended Contractors
              <ChevronRight className="h-5 w-5" />
            </Link>
          </Button>
        </Card>

        {/* Recent Jobs Carousel */}
        <div className="mb-6">
          <h3 className="mb-4 text-xl font-bold text-white drop-shadow">
            Recent Work in Your Area
          </h3>
          <RecentJobsCarousel />
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-white/60">
          <p>Sasquatch Carpet Cleaning</p>
          <p>Monument • Colorado Springs • Castle Rock • Black Forest</p>
          <p className="mt-2">
            $20 off with code {couponCode} - add to booking notes!
          </p>
        </div>
      </div>

      {/* Share Toast Notification */}
      {showShareToast && (
        <div className="fixed top-20 right-1/2 z-50 translate-x-1/2 animate-[fade-in_0.3s_ease-out] rounded-lg bg-green-600 px-6 py-3 text-sm font-semibold text-white shadow-xl">
          ✓ Link copied to clipboard!
        </div>
      )}

      <PushOptInBanner
        headline="Get $20 off your next cleaning"
        subline="Allow notifications for exclusive deals and last-minute openings."
      />
    </div>
  )
}
