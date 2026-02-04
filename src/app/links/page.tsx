'use client'

import { useState } from 'react'
import {
  Phone,
  MessageSquare,
  Download,
  Star,
  ExternalLink,
  MapPin,
  Home,
  Building2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { RecentJobsCarousel } from '@/components/nfc/recent-jobs-carousel'
import { VideoBackground } from '@/components/public/VideoBackground'

// Review links
const REVIEW_LINKS: {
  name: string
  url: string
  icon: 'google' | 'facebook' | 'yelp' | 'nextdoor' | 'bbb'
  color: string
}[] = [
  {
    name: 'Google',
    url: 'https://search.google.com/local/writereview?placeid=ChIJw1Fmyv9_EQIRSsL80280NoQ',
    icon: 'google',
    color: 'bg-blue-600/70 hover:bg-blue-700/80',
  },
  {
    name: 'Yelp',
    url: 'https://www.yelp.com/writeareview/biz/xnyuNIUiJhSOytPGCW2e4w',
    icon: 'yelp',
    color: 'bg-red-600/70 hover:bg-red-700/80',
  },
  {
    name: 'Facebook',
    url: 'https://www.facebook.com/sasquatchcarpet/reviews',
    icon: 'facebook',
    color: 'bg-blue-800/70 hover:bg-blue-900/80',
  },
  {
    name: 'Nextdoor',
    url: 'https://nextdoor.com/page/sasquatch-carpet-cleaning-llc-palmer-lake-co',
    icon: 'nextdoor',
    color: 'bg-green-600/70 hover:bg-green-700/80',
  },
  {
    name: 'BBB',
    url: 'https://www.bbb.org/us/co/palmer-lake/profile/carpet-and-rug-cleaners/sasquatch-carpet-cleaning-0785-1000034131',
    icon: 'bbb',
    color: 'bg-blue-500/70 hover:bg-blue-600/80',
  },
]

// Icon component for review links
function ReviewIcon({ type }: { type: string }) {
  switch (type) {
    case 'google':
      return <MapPin className="h-5 w-5" />
    case 'facebook':
      return <span className="text-lg font-bold">f</span>
    case 'yelp':
      return <Star className="h-5 w-5" />
    case 'nextdoor':
      return <Home className="h-5 w-5" />
    case 'bbb':
      return <Building2 className="h-5 w-5" />
    default:
      return <Star className="h-5 w-5" />
  }
}

export default function LinksPage() {
  const [showShareToast, setShowShareToast] = useState(false)
  const couponCode = 'NEXT20'
  const shareCouponCode = 'SHARE20'

  const handleCall = () => {
    window.location.href = 'tel:719-249-8791'
  }

  const handleText = () => {
    const prefilledMessage =
      'Hi! I found your link page and I am interested in carpet cleaning.'
    window.location.href = `sms:719-249-8791?body=${encodeURIComponent(prefilledMessage)}`
  }

  const handleSaveContact = async () => {
    // Create vCard
    const vcard = `BEGIN:VCARD
VERSION:3.0
FN:Sasquatch Carpet Cleaning
ORG:Sasquatch Carpet Cleaning
TEL;TYPE=WORK,VOICE:719-249-8791
URL:https://sasquatchcarpet.com
NOTE:$20 OFF! Use code ${couponCode} in booking notes.
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
    const shareUrl = window.location.href
    const shareText = `🦶 Get $20 OFF carpet cleaning from Sasquatch! Use code ${shareCouponCode} when booking. Colorado Springs area.`

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

  // Filter to only show links that have URLs
  const activeReviewLinks = REVIEW_LINKS.filter((link) => link.url)

  return (
    <div className="relative min-h-screen overflow-hidden">
      <VideoBackground video="clouds" />

      {/* Sasquatch character - multiply blend mode to remove white bg */}
      <img
        src="/proudsquatch-white.png"
        alt=""
        className="pointer-events-none fixed left-1/2 z-[5] h-[75vh] w-auto -translate-x-1/2"
        style={{
          mixBlendMode: 'multiply',
          bottom: '-5%',
        }}
      />

      {/* Content */}
      <div className="relative z-10 mx-auto max-w-2xl px-4 py-8">
        {/* Logo Header */}
        <div className="mb-6 text-center">
          <img
            src="/logo.svg"
            alt="Sasquatch Carpet Cleaning"
            className="mx-auto h-24 w-auto drop-shadow-lg"
          />
          <p className="mt-2 text-white/80">
            Monument • Colorado Springs • Larkspur • Castle Rock • Palmer Lake
          </p>
        </div>

        {/* Review Links Section */}
        {activeReviewLinks.length > 0 && (
          <Card className="mb-6 border-white/20 bg-black/50 p-6">
            <h3 className="mb-4 flex items-center gap-2 text-xl font-bold text-white">
              <Star className="h-5 w-5 text-yellow-400" />
              Leave Us a Review
            </h3>
            <div className="space-y-3">
              {activeReviewLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex w-full items-center justify-between rounded-lg px-4 py-3 text-white transition-all hover:scale-[1.02] ${link.color}`}
                >
                  <span className="flex items-center gap-3">
                    <ReviewIcon type={link.icon} />
                    <span className="font-semibold">
                      Review us on {link.name}
                    </span>
                  </span>
                  <ExternalLink className="h-4 w-4 opacity-70" />
                </a>
              ))}
            </div>
          </Card>
        )}

        {/* Placeholder for when no review links are configured */}
        {activeReviewLinks.length === 0 && (
          <Card className="mb-6 border-white/20 bg-black/80 p-6">
            <h3 className="mb-4 flex items-center gap-2 text-xl font-bold text-white">
              <Star className="h-5 w-5 text-yellow-400" />
              Leave Us a Review
            </h3>
            <p className="text-sm text-white/70">
              Review links coming soon! In the meantime, search for
              &quot;Sasquatch Carpet Cleaning&quot; on Google or Facebook.
            </p>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="mb-6 space-y-3">
          {/* PRIMARY CTA - Book Again */}
          <a
            href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true"
            target="_blank"
            rel="noopener noreferrer"
            className="group relative block w-full overflow-hidden rounded-2xl shadow-2xl transition-all hover:scale-105"
          >
            {/* Button with 3D effect */}
            <div className="relative bg-gradient-to-b from-green-400/70 to-green-600/70 px-8 py-8 text-center transition-all group-hover:from-green-500/80 group-hover:to-green-700/80">
              {/* Top highlight for 3D effect */}
              <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-b from-white/30 to-transparent" />

              {/* Button text with press animation */}
              <div className="animate-button-press relative">
                <p className="mb-1 text-sm font-semibold tracking-wide text-white/90 uppercase">
                  Thanks for choosing us!
                </p>
                <p className="text-3xl font-black text-white drop-shadow-lg">
                  🎁 $20 OFF Your Next Clean
                </p>
                <p className="mt-1 text-lg font-bold text-white/90">
                  Use code: {couponCode} in notes
                </p>
              </div>

              {/* Bottom shadow for 3D depth */}
              <div className="absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-black/20 to-transparent" />
            </div>

            {/* Shine effect on hover */}
            <div className="absolute inset-0 translate-x-[-100%] bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-[100%]" />
          </a>

          {/* Share Button - Big and prominent */}
          <button
            onClick={handleShare}
            className="group relative block w-full overflow-hidden rounded-2xl shadow-2xl transition-all hover:scale-105"
          >
            {/* Button with 3D effect */}
            <div className="relative bg-gradient-to-b from-blue-400/70 to-blue-600/70 px-8 py-8 text-center transition-all group-hover:from-blue-500/80 group-hover:to-blue-700/80">
              {/* Top highlight for 3D effect */}
              <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-b from-white/30 to-transparent" />

              {/* Button text */}
              <div className="relative">
                <p className="mb-1 text-sm font-semibold tracking-wide text-white/90 uppercase">
                  Know someone who needs a clean?
                </p>
                <p className="text-3xl font-black text-white drop-shadow-lg">
                  🤝 Give $20 to a Friend
                </p>
                <p className="mt-1 text-lg font-bold text-white/90">
                  Code: {shareCouponCode}
                </p>
              </div>

              {/* Bottom shadow for 3D depth */}
              <div className="absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-black/20 to-transparent" />
            </div>

            {/* Shine effect on hover */}
            <div className="absolute inset-0 translate-x-[-100%] bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-[100%]" />
          </button>

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
            <Download className="mr-2 h-5 w-5" />
            Save to Contacts
          </Button>
        </div>

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
    </div>
  )
}
