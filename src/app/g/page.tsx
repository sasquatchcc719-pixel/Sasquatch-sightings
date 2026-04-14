'use client'

import { useState } from 'react'
import Image from 'next/image'
import {
  Phone,
  MessageSquare,
  UserPlus,
  Star,
  MapPin,
  Share2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { RecentJobsCarousel } from '@/components/nfc/recent-jobs-carousel'
import { VideoBackground } from '@/components/public/VideoBackground'
import { PushOptInBanner } from '@/components/push-opt-in-banner'

const PHONE_RAW = '7192498791'
const PHONE_DISPLAY = '(719) 249-8791'
const SMS_BODY = encodeURIComponent(
  "Hi! I found you on Google and I'm interested in carpet cleaning. Can I get a quote?",
)
const GOOGLE_REVIEW_URL =
  'https://search.google.com/local/writereview?placeid=ChIJw1Fmyv9_EQIRSsL80280NoQ'

const STANDARD_PRICING = [
  { label: 'Small Area / Hall (50–100 sqft)', price: '$25' },
  { label: 'Regular Room (100–200 sqft)', price: '$46' },
  { label: 'Sasquatch Size (200–400 sqft)', price: '$90' },
  { label: 'Monster Size (400–600 sqft)', price: '$138' },
  { label: 'Stairs', price: '$4/step' },
  { label: 'Pet Treatment', price: '+$25/room' },
]

const DEEP_PRICING = [
  { label: '100–200 sqft', price: '$75' },
  { label: '201–400 sqft', price: '$150' },
  { label: '401–600 sqft', price: '$225' },
  { label: '601–800 sqft', price: '$300' },
]

const UPHOLSTERY_PRICING = [
  { label: 'Sofa', price: '$150' },
  { label: 'Loveseat', price: '$100' },
  { label: 'Sectional', price: '$15/ft' },
  { label: 'Recliner', price: '$75' },
  { label: 'Leather Sofa', price: '$199' },
  { label: 'Leather Loveseat', price: '$159' },
  { label: 'Tile & Grout', price: '$0.80/sqft' },
  { label: 'Area Rugs', price: '$0.80/sqft' },
]

function PriceRow({ label, price }: { label: string; price: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 py-2 last:border-0">
      <span className="text-sm text-white/75">{label}</span>
      <span className="text-sm font-semibold text-cyan-400">{price}</span>
    </div>
  )
}

function Accordion({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between bg-white/5 px-4 py-3 text-left text-sm font-semibold tracking-wide text-white transition hover:bg-white/10"
      >
        {title}
        {open ? (
          <ChevronUp className="h-4 w-4 text-cyan-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-cyan-400" />
        )}
      </button>
      {open && <div className="px-4 py-3">{children}</div>}
    </div>
  )
}

export default function GoogleLandingPage() {
  const [showShareToast, setShowShareToast] = useState(false)

  const handleText = () => {
    window.location.href = `sms:${PHONE_RAW}?body=${SMS_BODY}`
  }

  const handleCall = () => {
    window.location.href = `tel:+1${PHONE_RAW}`
  }

  const handleSaveContact = () => {
    window.location.href = `/api/sasquatch-contact?code=GOOGLE`
  }

  const handleShare = async () => {
    const shareUrl = window.location.href
    const shareText =
      '🦶 Sasquatch Carpet Cleaning — Colorado Springs area. Professional carpet, upholstery & tile cleaning!'
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Sasquatch Carpet Cleaning',
          text: shareText,
          url: shareUrl,
        })
      } catch {
        copyToClipboard(shareUrl)
      }
    } else {
      copyToClipboard(shareUrl)
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setShowShareToast(true)
      setTimeout(() => setShowShareToast(false), 3000)
    } catch {
      alert('Link: ' + text)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <VideoBackground video="clouds" />

      <div className="relative z-10 mx-auto max-w-lg px-4 py-6">
        {/* Header */}
        <div className="mb-5 text-center">
          <img
            src="/logo.svg"
            alt="Sasquatch Carpet Cleaning"
            className="mx-auto mb-3 h-20 w-auto drop-shadow-lg"
          />
          <div className="mb-1 flex items-center justify-center gap-1">
            {[1, 2, 3, 4, 5].map((s) => (
              <Star
                key={s}
                className="h-4 w-4 fill-yellow-400 text-yellow-400"
              />
            ))}
            <span className="ml-1 text-sm font-semibold text-white">5.0</span>
          </div>
          <p className="text-xs text-white/60">
            Colorado&apos;s Front Range · Monument · Colorado Springs · Castle
            Rock
          </p>
        </div>

        {/* Hero card */}
        <Card className="mb-4 overflow-hidden border-cyan-500/40 bg-black/70 backdrop-blur-sm">
          <div className="relative">
            <Image
              src="/nfc-card.png"
              alt="Sasquatch Carpet Cleaning"
              width={700}
              height={394}
              className="w-full"
              priority
            />
          </div>
          <div className="p-4">
            <p className="mb-4 text-center text-sm text-white/70">
              Professional carpet, upholstery, tile &amp; leather cleaning.{' '}
              <span className="font-medium text-cyan-400">
                $150 minimum dispatch.
              </span>
            </p>

            {/* Primary CTAs */}
            <div className="space-y-2">
              {/* Book Online CTA */}
              <a
                href="/book"
                className="group relative block w-full overflow-hidden rounded-xl shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <div className="relative bg-gradient-to-b from-green-400 to-green-600 px-6 py-5 text-center transition-all group-hover:from-green-500 group-hover:to-green-700">
                  <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-b from-white/30 to-transparent" />
                  <p className="text-xs font-semibold tracking-wide text-white/80 uppercase">
                    Pick your services &amp; schedule online
                  </p>
                  <p className="text-2xl font-black text-white drop-shadow">
                    📅 BOOK ONLINE
                  </p>
                  <p className="text-sm font-semibold text-white/80">
                    See real-time availability · Instant confirmation
                  </p>
                  <div className="absolute inset-x-0 bottom-0 h-2 bg-gradient-to-t from-black/20 to-transparent" />
                </div>
                <div className="absolute inset-0 translate-x-[-100%] bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-[100%]" />
              </a>

              {/* Text to book */}
              <button
                onClick={handleText}
                className="group relative w-full overflow-hidden rounded-xl shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <div className="relative bg-gradient-to-b from-cyan-500 to-cyan-700 px-6 py-4 text-center transition-all group-hover:from-cyan-400 group-hover:to-cyan-600">
                  <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-b from-white/30 to-transparent" />
                  <p className="text-xs font-semibold tracking-wide text-white/80 uppercase">
                    Fastest way to get a quote
                  </p>
                  <p className="text-xl font-black text-white drop-shadow">
                    📱 TEXT TO BOOK
                  </p>
                  <p className="text-sm font-semibold text-white/80">
                    Harry (our AI) will quote &amp; schedule you instantly
                  </p>
                  <div className="absolute inset-x-0 bottom-0 h-2 bg-gradient-to-t from-black/20 to-transparent" />
                </div>
                <div className="absolute inset-0 translate-x-[-100%] bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-[100%]" />
              </button>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={handleCall}
                  className="w-full bg-blue-600 py-5 text-base font-bold hover:bg-blue-700"
                >
                  <Phone className="mr-1.5 h-4 w-4" />
                  Call Us
                </Button>
                <Button
                  onClick={handleText}
                  variant="outline"
                  className="w-full border-2 py-5 text-base font-semibold"
                >
                  <MessageSquare className="mr-1.5 h-4 w-4" />
                  Text Us
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={handleSaveContact}
                  variant="outline"
                  className="w-full border-2 py-4 text-sm font-semibold"
                >
                  <UserPlus className="mr-1.5 h-4 w-4" />
                  Save Contact
                </Button>
                <Button
                  onClick={handleShare}
                  variant="outline"
                  className="w-full border-2 border-blue-500 py-4 text-sm font-semibold text-blue-400 hover:bg-blue-950"
                >
                  <Share2 className="mr-1.5 h-4 w-4" />
                  Share
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Leave a Review */}
        <Card className="mb-4 border-yellow-500/30 bg-black/60 p-4 backdrop-blur-sm">
          <p className="mb-2 text-center text-sm font-semibold text-white">
            Happy with your clean? Leave us a review 👇
          </p>
          <a
            href={GOOGLE_REVIEW_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-bold text-gray-800 shadow transition hover:bg-gray-100"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Review us on Google
          </a>
        </Card>

        {/* Pricing — Accordion */}
        <Card className="mb-4 border-white/10 bg-black/60 p-4 backdrop-blur-sm">
          <h3 className="mb-3 text-sm font-semibold tracking-widest text-cyan-400 uppercase">
            Pricing Guide
          </h3>
          <div className="space-y-2">
            <Accordion title="🧹 Standard Carpet Cleaning" defaultOpen>
              {STANDARD_PRICING.map((r) => (
                <PriceRow key={r.label} {...r} />
              ))}
            </Accordion>
            <Accordion title="⚡ Deep Restoration Clean">
              {DEEP_PRICING.map((r) => (
                <PriceRow key={r.label} {...r} />
              ))}
            </Accordion>
            <Accordion title="🛋️ Upholstery, Tile & Rugs">
              {UPHOLSTERY_PRICING.map((r) => (
                <PriceRow key={r.label} {...r} />
              ))}
            </Accordion>
          </div>
          <p className="mt-3 text-center text-xs text-white/30">
            $150 minimum · Prices are estimates — final quote in the chat
          </p>
        </Card>

        {/* Recent Work */}
        <div className="mb-4">
          <h3 className="mb-3 text-center text-sm font-semibold tracking-widest text-white/70 uppercase">
            Recent Work Near You
          </h3>
          <RecentJobsCarousel />
        </div>

        {/* Service Area */}
        <Card className="mb-4 border-white/10 bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-cyan-400" />
            <div className="text-sm text-white/70">
              <span className="font-medium text-white">Service Area: </span>
              Monument · Palmer Lake · Woodmoor · Colorado Springs (North) ·
              Briargate · Flying Horse · Black Forest · Castle Rock · Larkspur ·
              Falcon · Peyton
            </div>
          </div>
        </Card>

        {/* Bottom CTA */}
        <button
          onClick={handleText}
          className="group relative mb-6 w-full overflow-hidden rounded-xl shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <div className="relative bg-gradient-to-b from-cyan-500 to-cyan-700 px-6 py-5 text-center transition-all group-hover:from-cyan-400 group-hover:to-cyan-600">
            <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-b from-white/30 to-transparent" />
            <p className="text-xl font-black text-white drop-shadow">
              📱 Text Us to Get Started
            </p>
            <p className="text-sm text-white/80">{PHONE_DISPLAY}</p>
            <div className="absolute inset-x-0 bottom-0 h-2 bg-gradient-to-t from-black/20 to-transparent" />
          </div>
        </button>

        {/* Footer */}
        <div className="text-center text-xs text-white/40">
          <p>Sasquatch Carpet Cleaning · Monument, CO</p>
          <p className="mt-1">{PHONE_DISPLAY}</p>
        </div>
      </div>

      {showShareToast && (
        <div className="fixed top-20 right-1/2 z-50 translate-x-1/2 animate-[fade-in_0.3s_ease-out] rounded-lg bg-green-600 px-6 py-3 text-sm font-semibold text-white shadow-xl">
          ✓ Link copied to clipboard!
        </div>
      )}

      <PushOptInBanner
        headline="Get notified about last-minute openings"
        subline="We'll text you when a spot opens up near you."
      />
    </div>
  )
}
