'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Image from 'next/image'
import {
  Phone,
  MessageSquare,
  Download,
  MapPin,
  Clock,
  Share2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { RecentJobsCarousel } from '@/components/nfc/recent-jobs-carousel'

export default function TapLandingPage() {
  const searchParams = useSearchParams()
  const cardId = searchParams.get('card')
  const partnerId = searchParams.get('partner') // For location partners
  const [tapId, setTapId] = useState<string | null>(null)
  const [partnerName, setPartnerName] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showShareToast, setShowShareToast] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    zip: '',
  })

  // Track the tap on page load
  useEffect(() => {
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
      } catch (error) {
        console.error('Failed to track tap:', error)
      }
    }

    trackTap()
  }, [cardId, partnerId])

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
    window.location.href = 'sms:719-249-8791'
  }

  const handleSaveContact = async () => {
    trackButtonClick('save_contact')

    // Create vCard
    const vcard = `BEGIN:VCARD
VERSION:3.0
FN:Sasquatch Carpet Cleaning
ORG:Sasquatch Carpet Cleaning
TEL;TYPE=WORK,VOICE:719-249-8791
URL:https://sasquatchcarpet.com
NOTE:$20 OFF every cleaning! Mention this card.
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
    trackButtonClick('share')

    const shareUrl = window.location.href
    const shareText =
      '🦶 Get $20 OFF carpet cleaning from Sasquatch! Professional service in Colorado Springs area. Book now:'

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

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      // Submit the lead
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          phone: formData.phone,
          zip_code: formData.zip,
          source: cardId ? `NFC Card - ${cardId}` : 'NFC Card Tap',
          notes: `$20 OFF coupon from NFC card tap - valid every cleaning`,
        }),
      })

      if (response.ok) {
        // Track conversion
        trackButtonClick('form_submit')

        // Show success message
        alert(
          "🎉 Thanks! We'll call you soon to schedule your cleaning and apply your $20 discount!",
        )
        setShowForm(false)
        setFormData({ name: '', phone: '', zip: '' })
      } else {
        alert('Something went wrong. Please call us at 719-249-8791')
      }
    } catch (error) {
      console.error('Failed to submit form:', error)
      alert('Something went wrong. Please call us at 719-249-8791')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-green-50 dark:from-gray-900 dark:to-gray-800">
      {/* Hero Section */}
      <div className="mx-auto max-w-2xl px-4 py-8">
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

        {/* Action Buttons - Moved right under card */}
        <div className="mb-6 space-y-3">
          {/* PRIMARY CTA - Book Online with Animation */}
          <a
            href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackButtonClick('booking_page')}
            className="group relative block w-full overflow-hidden rounded-2xl shadow-2xl transition-all hover:scale-105"
          >
            {/* Button with 3D effect */}
            <div className="relative bg-gradient-to-b from-green-400 to-green-600 px-8 py-8 text-center transition-all group-hover:from-green-500 group-hover:to-green-700">
              {/* Top highlight for 3D effect */}
              <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-b from-white/30 to-transparent" />

              {/* Button text with press animation */}
              <div className="animate-button-press relative">
                <p className="mb-1 text-sm font-semibold tracking-wide text-white/90 uppercase">
                  Click to Schedule
                </p>
                <p className="text-3xl font-black text-white drop-shadow-lg">
                  📅 BOOK NOW
                </p>
                <p className="mt-1 text-lg font-bold text-white/90">
                  Get $20 OFF Every Cleaning
                </p>
              </div>

              {/* Bottom shadow for 3D depth */}
              <div className="absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-black/20 to-transparent" />
            </div>

            {/* Shine effect on hover */}
            <div className="absolute inset-0 translate-x-[-100%] bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-[100%]" />
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

        {/* Location Partner Badge (if applicable) */}
        {partnerName && (
          <Card className="mb-6 border-2 border-amber-300 bg-gradient-to-r from-yellow-50 to-amber-50 p-4 dark:border-amber-700 dark:from-yellow-900/20 dark:to-amber-900/20">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
              <span className="text-xl">🎁</span>
              <span>Found at: {partnerName}</span>
            </div>
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
              This location earns rewards for sharing our service!
            </p>
          </Card>
        )}

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

        {/* Contact Form */}
        {showForm && (
          <Card className="mb-6 p-6">
            <h3 className="mb-4 text-xl font-bold">Request a Call Back</h3>
            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div>
                <Label htmlFor="name">Your Name</Label>
                <Input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="John Smith"
                  required
                />
              </div>

              <div>
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) =>
                    setFormData({ ...formData, phone: e.target.value })
                  }
                  placeholder="719-555-0123"
                  required
                />
              </div>

              <div>
                <Label htmlFor="zip">ZIP Code</Label>
                <Input
                  id="zip"
                  type="text"
                  value={formData.zip}
                  onChange={(e) =>
                    setFormData({ ...formData, zip: e.target.value })
                  }
                  placeholder="80132"
                  required
                />
              </div>

              <Button
                type="submit"
                className="w-full bg-green-600 hover:bg-green-700"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Submitting...' : 'Get My $20 Off'}
              </Button>
            </form>
          </Card>
        )}

        {/* Why Choose Us */}
        <Card className="mb-6 p-6">
          <h3 className="mb-4 text-xl font-bold">Why Choose Sasquatch?</h3>
          <ul className="space-y-2 text-sm">
            <li>✅ Professional carpet, tile & upholstery cleaning</li>
            <li>✅ Serving Colorado Springs area since 2012</li>
            <li>✅ Same-day service available</li>
            <li>✅ 100% satisfaction guaranteed</li>
            <li>✅ Eco-friendly cleaning solutions</li>
          </ul>
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
