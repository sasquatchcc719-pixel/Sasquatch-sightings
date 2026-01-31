'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Camera,
  Upload,
  MapPin,
  Loader2,
  Copy,
  Check,
  CalendarCheck,
  Share2,
  ExternalLink,
  CheckCircle,
} from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import {
  extractExifGps,
  compressImage,
  getCurrentLocation,
  type GpsCoordinates,
} from '@/lib/image-utils'

// Form validation schema
const sightingFormSchema = z.object({
  image: z
    .any()
    .optional()
    .refine(
      (files) =>
        !files ||
        files.length === 0 ||
        (files instanceof FileList && files[0]?.type.startsWith('image/')),
      'File must be an image',
    ),
  fullName: z.string().min(2, 'Name required'),
  phoneNumber: z.string().min(10, 'Valid phone required'),
  email: z.string().email('Valid email is required'),
  locationText: z
    .string()
    .min(2, 'Please tell us where you saw us')
    .optional()
    .or(z.literal('')),
  zipCode: z
    .string()
    .regex(/^\d{5}$/, 'Valid 5-digit zip')
    .optional()
    .or(z.literal('')),
})

type SightingFormData = z.infer<typeof sightingFormSchema>

export default function SightingsPage() {
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [gpsCoordinates, setGpsCoordinates] = useState<GpsCoordinates | null>(
    null,
  )
  const [gpsSource, setGpsSource] = useState<'exif' | 'device' | 'none' | null>(
    null,
  )
  const [compressedFile, setCompressedFile] = useState<File | null>(null)
  const [isProcessingImage, setIsProcessingImage] = useState(false)
  const [isGettingLocation, setIsGettingLocation] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [couponCode, setCouponCode] = useState<string>('')
  // contestEligible is effectively deprecated for logic but we'll keep the UI minimal for now or just remove it
  const [sightingId, setSightingId] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [phoneCopied, setPhoneCopied] = useState(false)
  const [shareTextCopied, setShareTextCopied] = useState(false)
  const [entryVerified, setEntryVerified] = useState(false)
  const [locationAttempted, setLocationAttempted] = useState(false)
  const [canSubmit, setCanSubmit] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<SightingFormData>({
    resolver: zodResolver(sightingFormSchema),
  })

  const imageFiles = watch('image')

  // Process image: Extract EXIF (BEFORE compression), then compress
  useEffect(() => {
    async function processImage() {
      if (!imageFiles || imageFiles.length === 0) {
        setImagePreview(null)
        setGpsCoordinates(null)
        setGpsSource(null)
        setCompressedFile(null)
        return
      }

      setIsProcessingImage(true)
      const file = imageFiles[0]

      try {
        // STEP 1: Extract EXIF GPS data BEFORE compression
        const gps = await extractExifGps(file)
        if (gps) {
          setGpsCoordinates(gps)
          setGpsSource('exif')
          setCanSubmit(true) // GPS found, can submit
          setLocationAttempted(false) // Reset location attempt flag
        } else {
          setGpsCoordinates(null)
          setGpsSource('none')
          setCanSubmit(false) // No GPS, need location attempt
          setLocationAttempted(false) // Reset location attempt flag
        }

        // STEP 2: Compress image AFTER EXIF extraction
        const compressed = await compressImage(file)
        setCompressedFile(compressed)

        // STEP 3: Generate preview from compressed file
        const objectUrl = URL.createObjectURL(compressed)
        setImagePreview(objectUrl)

        // Cleanup function
        return () => URL.revokeObjectURL(objectUrl)
      } catch (error) {
        console.error('Error processing image:', error)
        // Fallback to original file if processing fails
        const objectUrl = URL.createObjectURL(file)
        setImagePreview(objectUrl)
        return () => URL.revokeObjectURL(objectUrl)
      } finally {
        setIsProcessingImage(false)
      }
    }

    processImage()
  }, [imageFiles])

  // Handle "Use Current Location" button click
  const handleUseCurrentLocation = async () => {
    setIsGettingLocation(true)
    setLocationAttempted(true)

    try {
      const location = await getCurrentLocation()
      if (location) {
        // Successfully got location
        setGpsCoordinates(location)
        setGpsSource('device')
        setCanSubmit(true)
      } else {
        // Location permission denied or failed
        setCanSubmit(true) // Still allow submission
      }
    } catch (error) {
      console.error('Error getting location:', error)
      // Even on error, allow submission
      setCanSubmit(true)
    } finally {
      setIsGettingLocation(false)
    }
  }

  // Handle copying coupon code to clipboard
  const handleCopyCoupon = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(couponCode)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } else {
        // Fallback: show alert with code to manually copy
        alert(`Your coupon code: ${couponCode}`)
      }
    } catch (error) {
      console.error('Failed to copy:', error)
      // Fallback on error
      alert(`Your coupon code: ${couponCode}`)
    }
  }

  // Handle copying phone number to clipboard
  const handleCopyPhone = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText('719-249-8791')
        setPhoneCopied(true)
        setTimeout(() => setPhoneCopied(false), 2000)
      } else {
        // Fallback: show alert with phone to manually copy
        alert('Phone: 719-249-8791')
      }
    } catch (error) {
      console.error('Failed to copy:', error)
      // Fallback on error
      alert('Phone: 719-249-8791')
    }
  }

  const onSubmit = async (data: SightingFormData) => {
    // With optional photo, we always allow submission
    // But if they have a photo without GPS and haven't tried location, prompt them
    const hasPhoto = imageFiles && imageFiles.length > 0 && compressedFile

    if (hasPhoto && gpsSource === 'none' && !locationAttempted) {
      setSubmitError(
        'Please click "Use Current Location" to help verify your photo.',
      )
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      // Prepare form data for upload
      const formData = new FormData()

      // Image is now optional
      if (hasPhoto && compressedFile) {
        formData.append('image', compressedFile)
      }

      formData.append('fullName', data.fullName)
      formData.append('phoneNumber', data.phoneNumber)
      formData.append('email', data.email)

      // Location text (where did you see us)
      if (data.locationText) {
        formData.append('locationText', data.locationText)
      }

      if (data.zipCode) {
        formData.append('zipCode', data.zipCode)
      }

      // GPS coordinates are optional
      if (gpsCoordinates) {
        formData.append('gpsLat', gpsCoordinates.lat.toString())
        formData.append('gpsLng', gpsCoordinates.lng.toString())
      }

      // Send to API
      const response = await fetch('/api/sightings', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Submission failed')
      }

      // Success!
      setSightingId(result.data.id)
      setCouponCode(result.couponCode)
      setSubmitSuccess(true)
    } catch (error) {
      console.error('Submit error:', error)
      setSubmitError(
        error instanceof Error ? error.message : 'Failed to submit sighting',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  // Social share text for viral loop
  const shareText = `I found the Sasquatch! 🦶📸 @SasquatchCarpetCleaning Enter to Win a Whole House Cleaning here: https://sightings.sasquatchcarpet.com`

  const handleCopyShareText = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareText)
        setShareTextCopied(true)
        setTimeout(() => setShareTextCopied(false), 3000)
      } else {
        alert(shareText)
      }
    } catch (error) {
      console.error('Failed to copy:', error)
      alert(shareText)
    }
  }

  const openFacebook = () => {
    // Try app first, fall back to web
    const fbAppUrl = 'fb://feed'
    const fbWebUrl = 'https://www.facebook.com/'

    // Copy text first
    handleCopyShareText()

    // Try to open app, fall back to web
    window.location.href = fbAppUrl
    setTimeout(() => {
      window.open(fbWebUrl, '_blank')
    }, 500)
  }

  const openInstagram = () => {
    // Try app first, fall back to web
    const igAppUrl = 'instagram://user?username=sasquatchcarpet'
    const igWebUrl = 'https://www.instagram.com/sasquatchcarpet/'

    // Copy text first
    handleCopyShareText()

    // Try to open app, fall back to web
    window.location.href = igAppUrl
    setTimeout(() => {
      window.open(igWebUrl, '_blank')
    }, 500)
  }

  if (submitSuccess) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <Card className="w-full max-w-2xl p-6 sm:p-8">
          {/* Step 1 Complete Header */}
          <div className="mb-6 text-center">
            <div className="mb-2 inline-block rounded-full bg-green-100 px-4 py-1 text-sm font-semibold text-green-800 dark:bg-green-900 dark:text-green-200">
              ✅ Step 1 Complete
            </div>
            <h1 className="mb-2 text-3xl font-bold sm:text-4xl">
              You&apos;re Almost There!
            </h1>
            <p className="text-muted-foreground">
              Your{' '}
              <span className="font-semibold text-green-600">$20 Coupon</span>{' '}
              is secured below.
            </p>
          </div>

          {/* VIRAL LOOP: Share to Enter Grand Prize */}
          <div className="mb-6 rounded-lg border-2 border-yellow-500 bg-yellow-50 p-5 dark:border-yellow-600 dark:bg-yellow-950/30">
            <div className="mb-3 flex items-center justify-center gap-2">
              <Share2 className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
              <h2 className="text-lg font-bold text-yellow-900 sm:text-xl dark:text-yellow-100">
                Final Step: Post & Tag Us! 🏆
              </h2>
            </div>
            <p className="mb-4 text-center text-sm text-yellow-800 dark:text-yellow-200">
              To complete your entry for the{' '}
              <strong>FREE Whole House Cleaning</strong>, share your sighting on
              social media!
            </p>

            {/* Copy Share Text Button */}
            <Button
              onClick={handleCopyShareText}
              size="lg"
              className="mb-3 w-full bg-yellow-500 text-yellow-950 hover:bg-yellow-400"
            >
              {shareTextCopied ? (
                <>
                  <Check className="mr-2 h-5 w-5" />
                  Copied! Now Paste & Post
                </>
              ) : (
                <>
                  <Copy className="mr-2 h-5 w-5" />
                  Copy Tag & Link
                </>
              )}
            </Button>

            {/* Social Media Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={openFacebook}
                size="lg"
                className="bg-[#1877F2] hover:bg-[#166FE5]"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Facebook
              </Button>
              <Button
                onClick={openInstagram}
                size="lg"
                className="bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] hover:opacity-90"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Instagram
              </Button>
            </div>

            <p className="mt-3 text-center text-xs text-yellow-700 dark:text-yellow-300">
              💡 We copied the tag & link for you. Just Paste & Post!
            </p>
          </div>

          {/* Verification Checkbox */}
          <div
            className={`mb-6 rounded-lg border-2 p-4 transition-all ${
              entryVerified
                ? 'border-green-500 bg-green-50 dark:border-green-600 dark:bg-green-950/30'
                : 'border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-900/30'
            }`}
          >
            <div className="flex items-center gap-3">
              <Checkbox
                id="verify-entry"
                checked={entryVerified}
                onCheckedChange={async (checked) => {
                  if (checked === true && sightingId) {
                    setEntryVerified(true)
                    // Call API to save verification
                    try {
                      await fetch(`/api/sightings/${sightingId}/verify`, {
                        method: 'POST',
                      })
                    } catch (error) {
                      console.error('Failed to save verification:', error)
                    }
                  }
                }}
                className="h-6 w-6"
              />
              <label
                htmlFor="verify-entry"
                className={`cursor-pointer text-sm font-semibold ${
                  entryVerified
                    ? 'text-green-700 dark:text-green-300'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                {entryVerified ? (
                  <span className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5" />
                    ENTRY VERIFIED! ✅
                  </span>
                ) : (
                  'Verify My Entry'
                )}
              </label>
            </div>
            {entryVerified && (
              <p className="mt-2 text-sm text-green-700 dark:text-green-300">
                We will look for your tag to pick the winner. Good luck! 🍀
              </p>
            )}
          </div>

          {/* Coupon Code Display */}
          <div className="mb-4 rounded-lg bg-gradient-to-r from-green-100 to-green-200 p-4 dark:from-green-900 dark:to-green-800">
            <p className="mb-1 text-center text-xs font-medium text-green-800 dark:text-green-200">
              Your Instant $20 Off Code:
            </p>
            <div className="flex items-center justify-center gap-2">
              <p className="text-2xl font-bold tracking-wider text-green-900 sm:text-3xl dark:text-green-100">
                {couponCode}
              </p>
              <Button
                onClick={handleCopyCoupon}
                size="sm"
                variant="outline"
                className="border-green-700 bg-white/50 hover:bg-white dark:border-green-300 dark:bg-green-950/50"
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Book Now Section */}
          <div className="bg-muted/30 mb-6 space-y-3 rounded-lg border p-4">
            <p className="text-center text-sm font-semibold">
              Ready to use your $20 off?
            </p>
            <Button
              size="lg"
              className="w-full bg-blue-600 hover:bg-blue-700"
              asChild
            >
              <a
                href="https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true"
                target="_blank"
                rel="noopener noreferrer"
              >
                <CalendarCheck className="mr-2 h-5 w-5" />
                Book Online Now
              </a>
            </Button>
            <p className="text-muted-foreground text-center text-xs">
              Mention code <span className="font-bold">{couponCode}</span> when
              booking
            </p>
          </div>

          <Button
            onClick={() => window.location.reload()}
            variant="outline"
            size="lg"
            className="w-full"
          >
            Submit Another Sighting
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="via-background to-background flex min-h-screen flex-col items-center bg-gradient-to-b from-green-950 p-4 py-12">
      <div className="w-full max-w-2xl space-y-8">
        {/* Header */}
        <div className="text-center">
          {/* Logo */}
          <div className="animate-fade-in mb-6 flex justify-center">
            <img
              src="/vector6-no-background.svg"
              alt="Sasquatch Carpet Cleaning"
              className="h-32 w-auto drop-shadow-2xl md:h-40"
            />
          </div>

          <h1 className="mb-2 text-5xl font-extrabold tracking-tight text-white">
            YOU FOUND SASQUATCH!
          </h1>
          <h2 className="mb-4 text-2xl font-bold text-green-400">
            Enter to WIN a Free Whole House Cleaning! 🏆
          </h2>
          <p className="mb-6 text-sm text-green-200/60">
            (Plus get an instant $20 coupon just for entering!)
          </p>

          <Card className="border-green-800/50 bg-green-900/30 p-6">
            <div className="space-y-3">
              <div className="rounded-md bg-green-800/50 p-4">
                <p className="text-lg font-bold text-green-200">
                  🎉 Everyone Gets $20 Off Just for Entering!
                </p>
              </div>
              <div className="rounded-md bg-yellow-900/40 p-3 text-sm">
                <p className="font-semibold text-yellow-200">
                  📸 Upload a Photo = Extra Entry in the Drawing!
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Form */}
        <Card className="p-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Where did you see us? */}
            <div className="space-y-2">
              <Label htmlFor="locationText">
                <MapPin className="mr-2 inline-block h-4 w-4" />
                Where did you see us?
              </Label>
              <Input
                id="locationText"
                type="text"
                placeholder="e.g., Woodmen & Powers, near King Soopers"
                {...register('locationText')}
              />
              {errors.locationText && (
                <p className="text-destructive text-sm">
                  {errors.locationText.message}
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                Intersection, neighborhood, or landmark
              </p>
            </div>

            {/* Image Upload - OPTIONAL */}
            <div className="space-y-2">
              <Label htmlFor="image">
                <Camera className="mr-2 inline-block h-4 w-4" />
                Upload Photo of Truck (Optional - Get an extra entry!)
              </Label>
              <Input
                id="image"
                type="file"
                accept="image/*"
                {...register('image')}
                className="cursor-pointer file:cursor-pointer"
                disabled={isProcessingImage}
              />
              {errors.image && (
                <p className="text-destructive text-sm">
                  {String(errors.image.message)}
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                📸 Photo uploads get an extra entry in the monthly drawing!
              </p>

              {/* Processing Indicator */}
              {isProcessingImage && (
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing image...
                </div>
              )}

              {/* Image Preview */}
              {imagePreview && (
                <div className="mt-4 space-y-3">
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="h-48 w-full rounded-lg object-cover"
                  />

                  {/* GPS Status Indicator */}
                  <div className="space-y-2">
                    <div className="bg-muted/50 flex items-center justify-between rounded-md border p-3">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        <span className="text-sm font-medium">
                          {gpsSource === 'exif' && '✓ Location detected'}
                          {gpsSource === 'device' && '✓ Location detected'}
                          {gpsSource === 'none' &&
                            !locationAttempted &&
                            'Location needed'}
                          {gpsSource === 'none' &&
                            locationAttempted &&
                            'Location attempt made'}
                        </span>
                      </div>

                      {/* Show "Use Current Location" button if no GPS and not attempted */}
                      {gpsSource === 'none' && !locationAttempted && (
                        <Button
                          type="button"
                          size="sm"
                          variant="default"
                          onClick={handleUseCurrentLocation}
                          disabled={isGettingLocation}
                          className="bg-blue-600 hover:bg-blue-700"
                        >
                          {isGettingLocation ? (
                            <>
                              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                              Getting...
                            </>
                          ) : (
                            <>
                              <MapPin className="mr-2 h-3 w-3" />
                              Use Current Location
                            </>
                          )}
                        </Button>
                      )}
                    </div>

                    {/* Show message after location attempt if denied/failed */}
                    {gpsSource === 'none' &&
                      locationAttempted &&
                      !gpsCoordinates && (
                        <div className="rounded-md bg-yellow-50 p-3 text-sm dark:bg-yellow-950/30">
                          <p className="text-yellow-800 dark:text-yellow-200">
                            Location helps us verify your sighting! You can
                            still submit without it.
                          </p>
                        </div>
                      )}
                  </div>
                </div>
              )}
            </div>

            {/* Full Name Input */}
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name *</Label>
              <Input
                id="fullName"
                type="text"
                placeholder="John Smith"
                {...register('fullName')}
              />
              {errors.fullName && (
                <p className="text-destructive text-sm">
                  {errors.fullName.message}
                </p>
              )}
            </div>

            {/* Phone Number Input */}
            <div className="space-y-2">
              <Label htmlFor="phoneNumber">Phone Number *</Label>
              <Input
                id="phoneNumber"
                type="tel"
                placeholder="(720) 555-1234"
                {...register('phoneNumber')}
                onChange={(e) => {
                  // Auto-format phone number as user types
                  const value = e.target.value.replace(/\D/g, '') // Remove non-digits
                  let formatted = value

                  if (value.length >= 3) {
                    formatted = `(${value.slice(0, 3)}) ${value.slice(3)}`
                  }
                  if (value.length >= 6) {
                    formatted = `(${value.slice(0, 3)}) ${value.slice(3, 6)}-${value.slice(6, 10)}`
                  }

                  e.target.value = formatted
                  register('phoneNumber').onChange(e)
                }}
                maxLength={14}
              />
              {errors.phoneNumber && (
                <p className="text-destructive text-sm">
                  {errors.phoneNumber.message}
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                Enter 10 digits - we&apos;ll format it for you
              </p>
            </div>

            {/* Email Input */}
            <div className="space-y-2">
              <Label htmlFor="email">Email Address *</Label>
              <Input
                id="email"
                type="email"
                placeholder="your@email.com"
                {...register('email')}
              />
              {errors.email && (
                <p className="text-destructive text-sm">
                  {errors.email.message}
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                We&apos;ll contact you here if you win!
              </p>
            </div>

            {/* Zip Code Input */}
            <div className="space-y-2">
              <Label htmlFor="zipCode">Zip Code (Optional)</Label>
              <Input
                id="zipCode"
                type="text"
                placeholder="80521"
                maxLength={5}
                {...register('zipCode')}
              />
              {errors.zipCode && (
                <p className="text-destructive text-sm">
                  {errors.zipCode.message}
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                Helps us serve your area better
              </p>
            </div>

            {/* Error Message */}
            {submitError && (
              <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
                {submitError}
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full bg-green-600 hover:bg-green-700"
              size="lg"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Enter to Win! 🎉
                </>
              )}
            </Button>

            {/* Show helper text if photo uploaded but no GPS */}
            {imagePreview && gpsSource === 'none' && !locationAttempted && (
              <p className="text-center text-sm text-amber-600 dark:text-amber-400">
                👆 Click &quot;Use Current Location&quot; above to verify your
                photo
              </p>
            )}
          </form>
        </Card>

        {/* Contest Rules */}
        <Card className="border-green-800/50 bg-green-900/20 p-6">
          <h3 className="mb-3 text-lg font-semibold text-white">
            Contest Rules:
          </h3>
          <ul className="space-y-2 text-sm text-green-200/70">
            <li className="flex items-start gap-2">
              <span className="text-green-400">•</span>
              <span>Monthly drawing for one winner</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400">•</span>
              <span>Prize: Whole house carpet cleaning (up to $350 value)</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400">•</span>
              <span>$20 coupon valid on services $150 or more</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400">•</span>
              <span>Must be 18+ to enter</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400">•</span>
              <span>No purchase necessary to enter drawing</span>
            </li>
          </ul>
        </Card>

        {/* Privacy Link */}
        <p className="text-center text-xs text-green-200/50">
          By entering, you agree to our{' '}
          <Link href="/privacy" className="underline hover:text-green-400">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  )
}
