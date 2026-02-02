'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { MessageSquare, Download, MapPin, Share2, Lock, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { RecentJobsCarousel } from '@/components/nfc/recent-jobs-carousel'
import { VideoBackground } from '@/components/public/VideoBackground'

interface PartnerInfo {
  id: string
  location_name: string | null
  company_name: string
  location_type: string | null
}

interface PartnerStats {
  id: string
  name: string
  phone: string | null
  creditBalance: number
  totalTaps: number
  totalConversions: number
}

export default function LocationPartnerPage() {
  const params = useParams()
  const partnerId = params.partnerId as string
  const [tapId, setTapId] = useState<string | null>(null)
  const [partner, setPartner] = useState<PartnerInfo | null>(null)
  const [showShareToast, setShowShareToast] = useState(false)

  // Partner portal state
  const [logoTapCount, setLogoTapCount] = useState(0)
  const [showLoginForm, setShowLoginForm] = useState(false)
  const [pin, setPin] = useState('')
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
        setShowLoginForm(true)
        return 0
      }

      return newCount
    })
  }

  // Handle partner login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
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
        setShowLoginForm(false)
        setPin('')
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

  // Main CTA - Text to start AI chat with partner context
  const handleTextChat = () => {
    void trackButtonClick('text_chat')
    const partnerName =
      partner?.location_name || partner?.company_name || 'a local partner'
    // Pre-fill message with partner attribution
    const message = encodeURIComponent(
      `Hi! I found your card at ${partnerName} and I'm interested in carpet cleaning. Can you help?`,
    )
    window.location.href = `sms:719-249-8791?body=${message}`
  }

  const handleSaveContact = () => {
    void trackButtonClick('save_contact')

    // Create vCard
    const vcard = `BEGIN:VCARD
VERSION:3.0
FN:Sasquatch Carpet Cleaning
ORG:Sasquatch Carpet Cleaning
TEL;TYPE=WORK,VOICE:719-249-8791
URL:https://sasquatchcarpet.com
NOTE:$20 OFF every cleaning! Found at ${partner?.location_name || 'a local partner'}.
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
    void trackButtonClick('share')

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
            <Card className="p-4 text-center">
              <div className="text-3xl font-black text-blue-600">
                {partnerStats.totalTaps}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                Total Scans
              </div>
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
            onClick={() => setPartnerStats(null)}
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
      {showLoginForm && (
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
                  setShowLoginForm(false)
                  setPin('')
                  setLoginError('')
                }}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <form onSubmit={handleLogin}>
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
        <div
          className="mb-6 cursor-pointer text-center select-none"
          onClick={handleLogoTap}
        >
          <h1 className="text-4xl font-black text-white drop-shadow-lg">
            🦶 Sasquatch
          </h1>
          <p className="text-lg font-semibold text-white/80">Carpet Cleaning</p>
          {/* Subtle hint after 2 taps */}
          {logoTapCount >= 2 && logoTapCount < 5 && (
            <p className="mt-1 animate-pulse text-xs text-gray-400">
              {5 - logoTapCount} more...
            </p>
          )}
        </div>

        {/* Location Partner Badge */}
        <Card className="mb-6 border-2 border-amber-500 bg-black/80 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
            <span className="text-xl">🎁</span>
            <span>Found at: {partnerDisplayName}</span>
          </div>
          <p className="mt-1 text-xs text-amber-200">
            Mention where you found us for $20 OFF!
          </p>
        </Card>

        {/* $20 OFF Banner */}
        <div className="mb-6 rounded-xl bg-gradient-to-r from-green-600 to-green-700 p-6 text-center text-white shadow-lg">
          <p className="text-sm font-semibold tracking-wide uppercase opacity-90">
            Exclusive Deal
          </p>
          <p className="text-4xl font-black">$20 OFF</p>
        </div>

        {/* Action Buttons */}
        <div className="mb-6 space-y-3">
          {/* PRIMARY CTA - Text to Start AI Chat */}
          <button
            onClick={handleTextChat}
            className="group relative block w-full overflow-hidden rounded-2xl shadow-2xl transition-all hover:scale-105"
          >
            {/* Button with 3D effect */}
            <div className="relative bg-gradient-to-b from-blue-400 to-blue-600 px-8 py-8 text-center transition-all group-hover:from-blue-500 group-hover:to-blue-700">
              {/* Top highlight for 3D effect */}
              <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-b from-white/30 to-transparent" />

              {/* Button text with press animation */}
              <div className="animate-button-press relative">
                <p className="mb-1 text-sm font-semibold tracking-wide text-white/90 uppercase">
                  Tap to Get Started
                </p>
                <p className="text-3xl font-black text-white drop-shadow-lg">
                  💬 TEXT US NOW
                </p>
                <p className="mt-1 text-lg font-bold text-white/90">
                  Our team will help you book!
                </p>
              </div>

              {/* Bottom shadow for 3D depth */}
              <div className="absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-black/20 to-transparent" />
            </div>

            {/* Shine effect on hover */}
            <div className="absolute inset-0 translate-x-[-100%] bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-[100%]" />
          </button>

          {/* Save Contact */}
          <Button
            onClick={handleSaveContact}
            size="lg"
            variant="outline"
            className="w-full border-2 py-6 text-lg font-semibold"
          >
            <Download className="mr-2 h-5 w-5" />
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

        {/* Trust Badges */}
        <div className="mb-6 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg border border-white/20 bg-black/80 p-3 shadow-md">
            <div className="text-2xl">⭐</div>
            <div className="text-xs font-bold text-white">5 Stars</div>
            <div className="text-xs text-white/60">on Google</div>
          </div>
          <div className="rounded-lg border border-white/20 bg-black/80 p-3 shadow-md">
            <div className="text-2xl">🐾</div>
            <div className="text-xs font-bold text-white">Pet Stain</div>
            <div className="text-xs text-white/60">Specialists</div>
          </div>
          <div className="rounded-lg border border-white/20 bg-black/80 p-3 shadow-md">
            <div className="text-2xl">🏢</div>
            <div className="text-xs font-bold text-white">Commercial</div>
            <div className="text-xs text-white/60">& Residential</div>
          </div>
        </div>

        {/* Guarantee Banner */}
        <div className="mb-6 rounded-lg border-2 border-green-500 bg-black/80 p-4 text-center">
          <p className="font-bold text-green-400">
            ✓ 100% Satisfaction Guaranteed
          </p>
          <p className="text-sm text-green-300">
            Not happy? We&apos;ll make it right.
          </p>
        </div>

        {/* Why We're Different */}
        <Card className="mb-6 border-white/20 bg-black/80 p-6">
          <h3 className="mb-4 text-xl font-bold text-white">
            The Deepest Clean in Colorado
          </h3>
          <p className="mb-4 text-sm text-white/80">
            Our standard cleaning is what other companies call their &quot;deep
            clean.&quot; Every job includes our full 3-step process:
          </p>
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-2">
              <span className="font-bold text-green-400">1.</span>
              <div>
                <span className="font-semibold text-white">
                  Pre-Spray Treatment
                </span>
                <p className="text-white/60">
                  Breaks down dirt, oils, and stains before we even start
                </p>
              </div>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-green-400">2.</span>
              <div>
                <span className="font-semibold text-white">CRB Agitation</span>
                <p className="text-white/60">
                  Counter-rotating brush works the solution deep into carpet
                  fibers
                </p>
              </div>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-green-400">3.</span>
              <div>
                <span className="font-semibold text-white">
                  Hot Water Extraction
                </span>
                <p className="text-white/60">
                  Powerful suction pulls out everything - dirt, allergens,
                  bacteria
                </p>
              </div>
            </li>
          </ul>
          <p className="mt-4 text-sm font-semibold text-green-400">
            The deepest clean you can get for the money. Period.
          </p>
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
          <p className="mt-2">$20 off valid on all residential cleanings.</p>
          {partner && (
            <p className="mt-1 text-amber-400">
              Thank you to {partnerDisplayName} for sharing us!
            </p>
          )}
        </div>
      </div>

      {/* Share Toast Notification */}
      {showShareToast && (
        <div className="fixed top-20 right-1/2 z-50 translate-x-1/2 animate-[fade-in_0.3s_ease-out] rounded-lg bg-green-600 px-6 py-3 text-sm font-semibold text-white shadow-xl">
          ✓ Link copied to clipboard!
        </div>
      )}
    </div>
  )
}
