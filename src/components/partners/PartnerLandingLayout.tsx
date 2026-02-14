'use client'

import { useState } from 'react'
import { Download, Share2, Lock, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { RecentJobsCarousel } from '@/components/nfc/recent-jobs-carousel'
import { VideoBackground } from '@/components/public/VideoBackground'

export interface PartnerInfo {
  id: string
  location_name: string | null
  company_name: string
  location_type: string | null
  couponCode?: string
}

export interface PartnerStats {
  id: string
  name: string
  phone: string | null
  creditBalance: number
  totalTaps: number
  totalConversions: number
  tapHistory?: { date: string; count: number }[]
}

interface PartnerLandingLayoutProps {
  partner: PartnerInfo | null
  partnerStats: PartnerStats | null
  onPartnerStatsChange: (stats: PartnerStats | null) => void
  onTrackClick: (buttonType: string) => void
  onLoginRequest: (pin: string) => Promise<void>
  loginError?: string
  isLoggingIn?: boolean
  loginModalOpen: boolean
  setLoginModalOpen: (open: boolean) => void
  logoTapCount: number
  onLogoTap: () => void
}

export function PartnerLandingLayout({
  partner,
  partnerStats,
  onPartnerStatsChange,
  onTrackClick,
  onLoginRequest,
  loginError = '',
  isLoggingIn = false,
  loginModalOpen,
  setLoginModalOpen,
  logoTapCount,
  onLogoTap,
}: PartnerLandingLayoutProps) {
  const [pin, setPin] = useState('')
  const [showShareToast, setShowShareToast] = useState(false)
  const [isTapsExpanded, setIsTapsExpanded] = useState(false)

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onLoginRequest(pin)
    if (!loginError) {
      setPin('')
    }
  }

  const handleSaveContact = () => {
    onTrackClick('save_contact')

    // Create vCard
    const vcard = `BEGIN:VCARD
VERSION:3.0
FN:Sasquatch Carpet Cleaning
ORG:Sasquatch Carpet Cleaning
TEL;TYPE=WORK,VOICE:719-249-8791
URL:https://sasquatchcarpet.com
NOTE:$20 OFF every cleaning! Found at ${partner?.location_name || 'a local partner'}. Use code ${partner?.couponCode || 'SCC20'}.
END:VCARD`

    const blob = new Blob([vcard], { type: 'text/vcard' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'Sasquatch-Carpet-Cleaning.vcf'
    link.click()
    window.URL.revokeObjectURL(url)
  }

  const handleShare = async () => {
    onTrackClick('share')

    const shareUrl = window.location.href
    const shareText =
      '🦶 Get $20 OFF carpet cleaning from Sasquatch! Professional service in Colorado Springs area. Text them to get started:'

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
          void copyToClipboard(shareUrl)
        }
      }
    } else {
      // Desktop: Copy to clipboard
      void copyToClipboard(shareUrl)
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

  const partnerDisplayName =
    partner?.location_name || partner?.company_name || 'our partner'

  const displayCouponCode = partner?.couponCode || 'SCC20'

  // If partner is logged in, show their dashboard
  if (partnerStats) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <VideoBackground />
        <div className="relative z-10 mx-auto max-w-2xl px-4 py-8">
          {/* Partner Dashboard Header */}
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-black text-gray-900 dark:text-white">
              🦶 Partner Portal
            </h1>
            <p className="text-lg font-semibold text-green-600">
              {partnerStats.name}
            </p>
          </div>

          {/* Stats Cards */}
          <div className="mb-6 grid grid-cols-3 gap-4">
            {/* Expandable Taps Card */}
            <Card
              className={`relative overflow-hidden p-4 text-center transition-all duration-300 ${
                isTapsExpanded
                  ? 'col-span-3'
                  : 'col-span-1 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
              onClick={() => setIsTapsExpanded(!isTapsExpanded)}
            >
              <div className="relative z-10">
                <div className="text-3xl font-black text-blue-600">
                  {partnerStats.totalTaps}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  Total Scans
                  {!isTapsExpanded && (
                    <span className="ml-1 opacity-50">▾</span>
                  )}
                </div>
              </div>

              {/* Chart (Shown when expanded) */}
              {isTapsExpanded && partnerStats.tapHistory && (
                <div className="animate-in fade-in slide-in-from-top-4 mt-4">
                  <h4 className="mb-2 text-sm font-semibold text-gray-500">
                    Last 30 Days
                  </h4>
                  <div className="flex h-32 items-end justify-between gap-1">
                    {partnerStats.tapHistory.map((day, i) => {
                      const maxCount = Math.max(
                        ...partnerStats.tapHistory!.map((d) => d.count),
                        1,
                      )
                      const height = Math.max((day.count / maxCount) * 100, 5) // Min 5% height

                      return (
                        <div
                          key={i}
                          className="group relative flex w-full flex-col items-center justify-end"
                        >
                          <div
                            className={`w-full rounded-t-sm transition-all ${
                              day.count > 0
                                ? 'bg-blue-500'
                                : 'bg-blue-100 dark:bg-blue-900/30'
                            }`}
                            style={{ height: `${height}%` }}
                          />
                          {/* Tooltip on hover */}
                          <div className="absolute -top-8 z-20 hidden rounded bg-black px-2 py-1 text-xs whitespace-nowrap text-white group-hover:block">
                            {day.date}: {day.count}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-gray-400">
                    <span>30 days ago</span>
                    <span>Today</span>
                  </div>
                </div>
              )}
            </Card>

            <Card className="p-4 text-center">
              <div className="text-3xl font-black text-green-600">
                {partnerStats.totalConversions}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                Bookings
              </div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-3xl font-black text-amber-600">
                ${partnerStats.creditBalance.toFixed(2)}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                Credits
              </div>
            </Card>
          </div>

          {/* Credit Explanation */}
          <Card className="mb-6 p-4">
            <h3 className="mb-2 font-bold">How Credits Work</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              You earn 1% of every job that books from your NFC card. Credits
              can be used toward your own carpet cleaning service.
            </p>
          </Card>

          {/* Cash Out Section */}
          <Card className="mb-6 border-2 border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20">
            <h3 className="mb-2 font-bold text-amber-800 dark:text-amber-200">
              Ready to Cash Out?
            </h3>
            <p className="mb-3 text-sm text-amber-700 dark:text-amber-300">
              When you have enough credits, contact us to apply them to your
              next cleaning!
            </p>
            <Button
              className="w-full bg-amber-600 hover:bg-amber-700"
              onClick={() =>
                (window.location.href =
                  'sms:719-249-8791?body=Hi! I want to use my partner credits toward a cleaning.')
              }
            >
              Text to Schedule & Use Credits
            </Button>
          </Card>

          {/* Logout */}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onPartnerStatsChange(null)}
          >
            Exit Partner Portal
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <VideoBackground />

      {/* Login Modal */}
      {loginModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-sm p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="h-5 w-5 text-green-600" />
                <h2 className="text-lg font-bold">Partner Login</h2>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setLoginModalOpen(false)
                  setPin('')
                }}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <form onSubmit={handleLoginSubmit}>
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium">
                  Enter your 4-digit PIN
                </label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, '').slice(0, 4))
                  }
                  placeholder="••••"
                  className="text-center text-2xl tracking-widest"
                  autoFocus
                />
                {loginError && (
                  <p className="mt-2 text-sm text-red-600">{loginError}</p>
                )}
              </div>
              <Button
                type="submit"
                className="w-full bg-green-600 hover:bg-green-700"
                disabled={pin.length !== 4 || isLoggingIn}
              >
                {isLoggingIn ? 'Logging in...' : 'Login'}
              </Button>
            </form>
          </Card>
        </div>
      )}

      {/* Hero Section */}
      <div className="relative z-10 mx-auto max-w-2xl px-4 py-8">
        {/* Logo/Header - Tappable for Easter Egg */}
        {/* Logo/Header - Tappable for Easter Egg */}
        <div
          className="mb-8 cursor-pointer text-center select-none"
          onClick={onLogoTap}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sasquatch-logo.png"
            alt="Sasquatch Carpet Cleaning"
            className="mx-auto h-40 w-auto drop-shadow-lg md:h-48"
          />
          {/* Subtle hint after 2 taps */}
          {logoTapCount >= 2 && logoTapCount < 5 && (
            <p className="mt-1 animate-pulse text-xs text-gray-400">
              {5 - logoTapCount} more...
            </p>
          )}
        </div>

        {/* 1. THE SELL: Why We Are Different (Moved to Top) */}
        <Card className="mb-8 border-white/20 bg-black/80 p-6 shadow-xl backdrop-blur-sm">
          <h2 className="mb-4 text-center text-2xl font-black text-white">
            Experience the <span className="text-green-400">Deepest Clean</span>{' '}
            in Colorado
          </h2>
          <p className="mb-6 text-center text-sm text-white/90">
            Don&apos;t settle for a &quot;splash & dash&quot; service. Our
            signature 3-step process removes more dirt, allergens, and pet odors
            than anyone else.
          </p>
          <ul className="space-y-4">
            <li className="flex items-start gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600 font-bold text-white shadow-lg shadow-green-900/50">
                1
              </div>
              <div>
                <span className="text-lg font-bold text-white">
                  Pre-Spray Treatment
                </span>
                <p className="text-sm text-white/70">
                  We verify fiber type and apply a custom solution to break down
                  oils and stubborn spots before we start.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600 font-bold text-white shadow-lg shadow-green-900/50">
                2
              </div>
              <div>
                <span className="text-lg font-bold text-white">
                  Power Agitation
                </span>
                <p className="text-sm text-white/70">
                  <span className="font-semibold text-green-400">
                    The step others skip.
                  </span>{' '}
                  Most companies rush this, but we take the extra time to scrub
                  fibers from the bottom up—releasing deep dirt that standard
                  cleaning leaves behind.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600 font-bold text-white shadow-lg shadow-green-900/50">
                3
              </div>
              <div>
                <span className="text-lg font-bold text-white">
                  Hot Water Extraction
                </span>
                <p className="text-sm text-white/70">
                  Powerful truck-mounted suction flushes out the suspended soil
                  with hot steam, leaving carpets fresh and nearly dry.
                </p>
              </div>
            </li>
          </ul>
          <p className="mt-6 text-center text-sm font-semibold text-white/90">
            <span className="text-green-400">Premier Service, Fair Price.</span>{' '}
            We provide the most thorough clean in town without the premium price
            tag. You get the deepest clean for your money—guaranteed.
          </p>
        </Card>

        {/* 3. THE ACTION: Buttons */}
        <div className="mb-8 space-y-4">
          {/* PRIMARY CTA - Giant Combined Button (Housecall Pro) */}
          <a
            href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => void onTrackClick('book_now')}
            className="group relative block w-full overflow-hidden rounded-2xl shadow-2xl transition-all hover:scale-[1.02] hover:shadow-green-900/50"
          >
            {/* Button Container */}
            <div className="relative bg-gradient-to-b from-green-500 to-green-700 px-6 py-6 text-center transition-all group-hover:from-green-500 group-hover:to-green-700">
              {/* Top highlight */}
              <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-b from-white/30 to-transparent" />

              {/* Content */}
              <div className="relative flex flex-col items-center justify-center gap-1">
                <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold tracking-wider text-white uppercase backdrop-blur-sm">
                  Exclusive Offer
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-black text-white drop-shadow-md">
                    $20 OFF
                  </span>
                  <span className="text-xl font-bold text-white/90">
                    & BOOK NOW
                  </span>
                </div>
                <p className="text-sm font-medium text-white/80">
                  Put code{' '}
                  <span className="text-white underline">
                    {displayCouponCode}
                  </span>{' '}
                  in booking notes
                </p>
              </div>

              {/* Bottom shadow */}
              <div className="absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-black/20 to-transparent" />
            </div>

            {/* Shine effect */}
            <div className="absolute inset-0 translate-x-[-100%] bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-1000 group-hover:translate-x-[100%]" />
          </a>

          {/* Secondary: Call Now */}
          <Button
            onClick={() => {
              void onTrackClick('call_now')
              window.location.href = 'tel:719-249-8791'
            }}
            size="lg"
            className="w-full border-2 border-white/20 bg-blue-600/90 py-6 text-lg font-bold text-white shadow-lg backdrop-blur-md hover:bg-blue-700"
          >
            📞 Call Us Now: 719-249-8791
          </Button>

          <div className="grid grid-cols-2 gap-3">
            {/* Save Contact */}
            <Button
              onClick={handleSaveContact}
              variant="outline"
              className="w-full border-white/20 bg-black/40 py-6 text-white backdrop-blur-md hover:bg-white/10 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
            >
              <Download className="mr-2 h-4 w-4" />
              Save Contact
            </Button>

            {/* Share Deal */}
            <Button
              onClick={handleShare}
              variant="outline"
              className="w-full border-white/20 bg-black/40 py-6 text-white backdrop-blur-md hover:bg-white/10 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
            >
              <Share2 className="mr-2 h-4 w-4" />
              Share Deal
            </Button>
          </div>
        </div>

        {/* 2. THE PROOF: Recent Work (Moved Below Buttons) */}
        <div className="mb-8">
          <h3 className="mb-4 text-center text-xl font-bold text-white drop-shadow-md">
            Recent Transformations Near You
          </h3>
          <RecentJobsCarousel />
        </div>

        {/* Trust Badges */}
        <div className="mb-8 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg border border-white/10 bg-black/60 p-3 shadow-lg backdrop-blur-sm">
            <div className="text-2xl">⭐</div>
            <div className="text-xs font-bold text-white">5 Stars</div>
            <div className="text-xs text-white/60">on Google</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/60 p-3 shadow-lg backdrop-blur-sm">
            <div className="text-2xl">🐾</div>
            <div className="text-xs font-bold text-white">Pet Stain</div>
            <div className="text-xs text-white/60">Experts</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/60 p-3 shadow-lg backdrop-blur-sm">
            <div className="text-2xl">✓</div>
            <div className="text-xs font-bold text-white">Satisfaction</div>
            <div className="text-xs text-white/60">Guaranteed</div>
          </div>
        </div>

        {/* Location Partner Badge (Moved to Bottom) */}
        <Card className="mb-6 border-2 border-amber-500 bg-black/80 p-4 shadow-xl backdrop-blur-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
            <span className="text-xl">🎁</span>
            <span>Found at: {partnerDisplayName}</span>
          </div>
          <p className="mt-1 text-xs text-amber-200">
            You unlocked an exclusive $20 OFF deal!
          </p>
        </Card>

        {/* Footer */}
        <div className="text-center text-xs text-white/50">
          <p className="font-semibold">Sasquatch Carpet Cleaning</p>
          <p>Monument • Colorado Springs • Castle Rock • Black Forest</p>
          <p className="mt-2 text-[10px] opacity-70">
            $20 off valid on all residential cleanings. Mention code at booking.
          </p>
          {partner && (
            <p className="mt-1 text-amber-500/80">
              Partner: {partnerDisplayName}
            </p>
          )}
        </div>
      </div>

      {/* Share Toast Notification */}
      {showShareToast && (
        <div className="fixed top-20 right-1/2 z-50 translate-x-1/2 animate-[fade-in_0.3s_ease-out] rounded-full bg-green-600 px-6 py-3 text-sm font-bold text-white shadow-2xl backdrop-blur-md">
          ✓ Link copied!
        </div>
      )}
    </div>
  )
}
