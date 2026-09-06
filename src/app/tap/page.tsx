'use client'

import { useEffect, useState } from 'react'
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
} from 'lucide-react'
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
  const isRedirecting = !!partnerId

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
      <div className={styles.backdrop} aria-hidden="true">
        <Image
          src="/hero-layer-forest.png"
          alt=""
          fill
          sizes="100vw"
          className={styles.forest}
        />
      </div>

      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.logoPlate}>
            <Image
              src="/sasquatch-website-logo.png"
              alt="Sasquatch Carpet Cleaning"
              width={2723}
              height={1155}
              sizes="232px"
              className={styles.logo}
              priority
            />
          </div>
          <p className={styles.eyebrow}>Your local cleaning crew</p>
          <h1>How can we help?</h1>
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
            <span className={styles.panelTop}>
              <CalendarCheck size={22} aria-hidden="true" />
              <span className={styles.offer}>$20 OFF CLEANING</span>
            </span>
            <span className={styles.panelTitle}>
              {showWidget ? 'Your cleaning estimate' : 'Get a free estimate'}
            </span>
            <span className={styles.panelDescription}>
              See prices & book your cleaning.
            </span>
            <span className={styles.panelBottom}>
              <span>{couponCode} auto-applied</span>
              <span className={styles.arrowCircle}>
                <ArrowRight size={20} aria-hidden="true" />
              </span>
            </span>
          </button>

          <a
            href={`tel:${WATER_DAMAGE_PHONE_E164}`}
            onClick={() => void trackButtonClick('call')}
            className={`${styles.actionPanel} ${styles.emergency}`}
          >
            <span className={styles.emergencyHeading}>
              <Droplets size={23} aria-hidden="true" />
              <span className={styles.emergencyTitle}>
                Water damage emergency
              </span>
            </span>
            <span className={styles.panelDescription}>
              Burst pipes · Leaks · Flooding
            </span>
            <span className={styles.emergencyCta}>
              <Phone size={17} aria-hidden="true" />
              Tap to call for help
              <ArrowUpRight size={20} aria-hidden="true" />
            </span>
          </a>
        </section>

        <div id="cleaning-estimator" hidden={!showWidget}>
          {showWidget && (
            <section
              className={styles.estimator}
              aria-label="Cleaning estimator"
            >
              <NfcBookingWidget
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
            onClick={() => void trackButtonClick('call')}
          >
            <Phone aria-hidden="true" />
            <span>
              Call the office<small>719-249-8791</small>
            </span>
          </a>
          <a
            href={`sms:719-249-8791?body=${encodeURIComponent(textMessage)}`}
            onClick={() => void trackButtonClick('text')}
          >
            <MessageSquare aria-hidden="true" />
            <span>
              Text us<small>Send a message</small>
            </span>
          </a>
          <a
            href={`/api/sasquatch-contact?code=${encodeURIComponent(couponCode)}`}
            onClick={() => void trackButtonClick('save_contact')}
          >
            <UserPlus aria-hidden="true" />
            <span>
              Save contact<small>Keep us handy</small>
            </span>
          </a>
          <button type="button" onClick={handleShare}>
            <Share2 aria-hidden="true" />
            <span>
              Share this card<small>Pass along $20 off</small>
            </span>
          </button>
        </nav>

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

        <section
          className={styles.recentWork}
          aria-label="Recent work in your area"
        >
          <div className={styles.sectionHeading}>
            <h2>Fresh from the field</h2>
            <span>RECENT WORK</span>
          </div>
          <RecentJobsCarousel compact />
        </section>

        <Link
          href="/recommended-contractors"
          className={styles.contractors}
          onClick={() => void trackButtonClick('recommended_contractors')}
        >
          <Wrench size={21} aria-hidden="true" />
          <span>
            Local pros we trust<small>Our recommended contractors</small>
          </span>
          <ArrowUpRight size={20} aria-hidden="true" />
        </Link>

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
