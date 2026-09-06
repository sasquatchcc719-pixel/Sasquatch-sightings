'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowRight,
  ArrowUpRight,
  Droplets,
  Phone,
  MessageSquare,
  UserPlus,
  Share2,
  Star,
  CalendarCheck,
  MapPin,
  Wrench,
  ChevronRight,
} from 'lucide-react'
import { TapForest } from './tap-forest'
import { RecentJobsCarousel } from '@/components/nfc/recent-jobs-carousel'
import { NfcBookingWidget } from '@/components/nfc/NfcBookingWidget'
import { PushOptInBanner } from '@/components/push-opt-in-banner'
import { WATER_DAMAGE_PHONE_E164 } from '@/lib/phone'
import styles from './tap.module.css'

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
  const estimatorRef = useRef<HTMLElement>(null)
  const isRedirecting = !!partnerId

  useEffect(() => {
    if (showWidget) {
      estimatorRef.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'start',
      })
    }
  }, [showWidget])

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
        keepalive: true,
      })
    } catch (error) {
      console.error('Failed to track button click:', error)
    }
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

  const textMessage = partnerName
    ? `Hi! I scanned the card at ${partnerName} and I'm interested in carpet cleaning.`
    : 'Hi! I scanned your card and I am interested in carpet cleaning.'

  return (
    <main className={styles.page}>
      <TapForest />

      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.logoPlate}>
            <Image
              src="/sasquatch-website-logo.png"
              alt="Sasquatch Carpet Cleaning"
              width={2723}
              height={1155}
              sizes="(max-width: 560px) 88vw, 480px"
              className={styles.logo}
              priority
            />
          </div>
          <h1 className="sr-only">
            Sasquatch Carpet Cleaning — your digital card
          </h1>
        </header>

        <section
          className={styles.primaryActions}
          aria-label="Cleaning and water damage help"
        >
          <button
            type="button"
            className={`${styles.actionPanel} ${styles.estimate}`}
            aria-expanded={showWidget}
            aria-controls="cleaning-estimator"
            onClick={() => {
              setShowWidget((visible) => !visible)
              if (!showWidget) void trackButtonClick('booking_widget_open')
            }}
          >
            <span className={styles.actionIcon}>
              <CalendarCheck aria-hidden="true" />
            </span>
            <span className={styles.actionCopy}>
              <span className={styles.panelTitle}>
                Get a free
                <br />
                estimate
              </span>
              <span className={styles.offer}>$20 off cleaning</span>
              <span className={styles.panelDescription}>
                {couponCode} auto-applied
              </span>
            </span>
            <ChevronRight className={styles.actionArrow} aria-hidden="true" />
          </button>

          <a
            href={`tel:${WATER_DAMAGE_PHONE_E164}`}
            onClick={() => void trackButtonClick('call')}
            className={`${styles.actionPanel} ${styles.emergency}`}
          >
            <span className={styles.actionIcon}>
              <Droplets aria-hidden="true" />
            </span>
            <span className={styles.actionCopy}>
              <span className={styles.emergencyTitle}>
                Water damage
                <br />
                emergency
              </span>
              <span className={styles.emergencyCta}>Tap to call for help</span>
            </span>
            <ChevronRight className={styles.actionArrow} aria-hidden="true" />
          </a>
        </section>

        <div id="cleaning-estimator" hidden={!showWidget}>
          {showWidget && (
            <section
              className={styles.estimator}
              aria-label="Cleaning estimator"
              ref={estimatorRef}
            >
              <div className={styles.estimatorHeader}>
                <span>Your cleaning estimate</span>
                <button type="button" onClick={() => setShowWidget(false)}>
                  Close
                </button>
              </div>
              <NfcBookingWidget
                appearance="forest"
                couponCode={couponCode}
                cardId={cardId}
                onTrackClick={trackButtonClick}
              />
            </section>
          )}
        </div>

        <nav
          className={styles.contactGrid}
          aria-label="Contact Sasquatch Carpet Cleaning"
        >
          <a
            href="tel:719-249-8791"
            aria-label="Call the office — 719-249-8791"
            onClick={() => void trackButtonClick('call')}
          >
            <Phone aria-hidden="true" />
            <span>Call</span>
          </a>
          <a
            href={`sms:719-249-8791?body=${encodeURIComponent(textMessage)}`}
            aria-label="Text us"
            onClick={() => void trackButtonClick('text')}
          >
            <MessageSquare aria-hidden="true" />
            <span>Text</span>
          </a>
          <a
            href={`/api/sasquatch-contact?code=${encodeURIComponent(couponCode)}`}
            aria-label="Save contact"
            onClick={() => void trackButtonClick('save_contact')}
          >
            <UserPlus aria-hidden="true" />
            <span>Save</span>
          </a>
          <button
            type="button"
            onClick={handleShare}
            aria-label="Share this card"
          >
            <Share2 aria-hidden="true" />
            <span>Share</span>
          </button>
        </nav>

        <a
          href="tel:719-249-8791"
          className={styles.officeNumber}
          onClick={() => void trackButtonClick('call')}
        >
          719-249-8791
        </a>

        <a
          className={styles.review}
          href="https://g.page/r/CVAp5EYpgMFLEBM/review"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => void trackButtonClick('review')}
        >
          <Star size={19} aria-hidden="true" />
          Leave us a review
          <ArrowUpRight size={18} aria-hidden="true" />
        </a>

        {partnerName && (
          <p className={styles.partner}>
            Found at {partnerName} · This location earns rewards for sharing our
            service.
          </p>
        )}

        <Link
          href="/recommended-contractors"
          className={styles.contractors}
          onClick={() => void trackButtonClick('recommended_contractors')}
        >
          <Wrench size={30} aria-hidden="true" />
          <span>
            <strong>Local pros we trust</strong>
            <small>Recommended contractors</small>
            <span className={styles.directoryCta}>
              View contractors <ArrowRight size={16} aria-hidden="true" />
            </span>
          </span>
          <ChevronRight size={22} aria-hidden="true" />
        </Link>

        <section
          className={styles.recentWork}
          aria-label="Recent work in your area"
        >
          <div className={styles.sectionHeading}>
            <h2>Recent work</h2>
          </div>
          <div className={styles.galleryFrame}>
            <RecentJobsCarousel compact />
          </div>
        </section>

        <PushOptInBanner
          placement="inline"
          headline="Stay in the loop"
          subline="Get occasional cleaning offers and last-minute openings."
        />

        <footer className={styles.footer}>
          <MapPin size={16} aria-hidden="true" />
          <p>
            Monument · Colorado Springs
            <br />
            Castle Rock · Black Forest
          </p>
          <span>Sasquatch Carpet Cleaning</span>
        </footer>
      </div>

      {showShareToast && (
        <div role="status" className={styles.toast}>
          Link copied — ready to share.
        </div>
      )}
    </main>
  )
}
