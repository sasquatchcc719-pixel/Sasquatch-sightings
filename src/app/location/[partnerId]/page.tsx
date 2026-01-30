'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { MessageSquare, Download, MapPin, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { RecentJobsCarousel } from '@/components/nfc/recent-jobs-carousel'

interface PartnerInfo {
  id: string
  location_name: string | null
  company_name: string
  location_type: string | null
}

export default function LocationPartnerPage() {
  const params = useParams()
  const partnerId = params.partnerId as string
  const [tapId, setTapId] = useState<string | null>(null)
  const [partner, setPartner] = useState<PartnerInfo | null>(null)
  const [showShareToast, setShowShareToast] = useState(false)

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

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-green-50 dark:from-gray-900 dark:to-gray-800">
      {/* Hero Section */}
      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* Logo/Header */}
        <div className="mb-6 text-center">
          <h1 className="text-4xl font-black text-gray-900 dark:text-white">
            🦶 Sasquatch
          </h1>
          <p className="text-lg font-semibold text-gray-600 dark:text-gray-300">
            Carpet Cleaning
          </p>
        </div>

        {/* Location Partner Badge */}
        <Card className="mb-6 border-2 border-amber-300 bg-gradient-to-r from-yellow-50 to-amber-50 p-4 dark:border-amber-700 dark:from-yellow-900/20 dark:to-amber-900/20">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
            <span className="text-xl">🎁</span>
            <span>Found at: {partnerDisplayName}</span>
          </div>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            Mention where you found us for $20 OFF!
          </p>
        </Card>

        {/* $20 OFF Banner */}
        <div className="mb-6 rounded-xl bg-gradient-to-r from-green-600 to-green-700 p-6 text-center text-white shadow-lg">
          <p className="text-sm font-semibold tracking-wide uppercase opacity-90">
            Exclusive Deal
          </p>
          <p className="text-4xl font-black">$20 OFF</p>
          <p className="mt-1 text-lg font-semibold">Every Carpet Cleaning</p>
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
        <Card className="mb-6 p-4">
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <MapPin className="h-4 w-4" />
            <span className="font-medium">We Serve:</span>
            <span>
              Monument • Colorado Springs • Castle Rock • Black Forest
            </span>
          </div>
        </Card>

        {/* Recent Jobs Carousel */}
        <div className="mb-6">
          <h3 className="mb-4 text-xl font-bold">Recent Work in Your Area</h3>
          <RecentJobsCarousel />
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-gray-500">
          <p>Sasquatch Carpet Cleaning</p>
          <p>Monument • Colorado Springs • Castle Rock • Black Forest</p>
          <p className="mt-2">$20 off valid on all residential cleanings.</p>
          {partner && (
            <p className="mt-1 text-amber-600">
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
