'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
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
import { Camera, Upload, MapPin, Loader2, Share2, Trophy, Copy, Check, CalendarCheck } from 'lucide-react'
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
    .refine(
      (files) => files instanceof FileList && files.length > 0,
      'Photo is required'
    )
    .refine(
      (files) => files instanceof FileList && files[0]?.type.startsWith('image/'),
      'File must be an image'
    ),
  fullName: z.string().min(2, 'Name required'),
  phoneNumber: z.string().min(10, 'Valid phone required'),
  email: z.string().email('Valid email is required'),
  zipCode: z.string().regex(/^\d{5}$/, 'Valid 5-digit zip').optional().or(z.literal('')),
  socialPlatform: z.enum(['facebook', 'instagram'] as const),
  socialLink: z.string().url('Valid social media post link is required').min(1, 'Social media share link is required'),
})

type SightingFormData = z.infer<typeof sightingFormSchema>

export default function SightingsPage() {
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [gpsCoordinates, setGpsCoordinates] = useState<GpsCoordinates | null>(
    null
  )
  const [gpsSource, setGpsSource] = useState<
    'exif' | 'device' | 'none' | null
  >(null)
  const [compressedFile, setCompressedFile] = useState<File | null>(null)
  const [isProcessingImage, setIsProcessingImage] = useState(false)
  const [isGettingLocation, setIsGettingLocation] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [couponCode, setCouponCode] = useState<string>('')
  const [contestEligible, setContestEligible] = useState(false)
  const [sightingId, setSightingId] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [phoneCopied, setPhoneCopied] = useState(false)
  const [shareLinkCopied, setShareLinkCopied] = useState(false)
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
  const socialPlatform = watch('socialPlatform')
  const socialLink = watch('socialLink')

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

  // Handle copying share link to clipboard
  const handleCopyShareLink = async () => {
    const shareUrl = `https://sightings.sasquatchcarpet.com/sightings/share/${sightingId}`
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl)
        setShareLinkCopied(true)
        setTimeout(() => setShareLinkCopied(false), 2000)
      }
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  // Handle Facebook share
  const handleFacebookShare = () => {
    const shareUrl = `https://sightings.sasquatchcarpet.com/sightings/share/${sightingId}`
    const facebookShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`
    window.open(facebookShareUrl, '_blank', 'width=600,height=400')
  }

  // Generate social media share URL based on platform
  const generateShareUrl = (platform: 'facebook' | 'instagram') => {
    const shareText = "I just spotted the Sasquatch Carpet Cleaning truck in [City]! 🚛"
    
    if (platform === 'facebook') {
      const encodedText = encodeURIComponent(shareText + " #SasquatchSighting")
      const shareUrl = encodeURIComponent(window.location.origin + '/sightings')
      return `https://www.facebook.com/sharer/sharer.php?u=${shareUrl}&quote=${encodedText}`
    } else {
      // Instagram doesn't have a web share URL, so we'll open Instagram
      // Note: User will need to manually post. We can't pre-fill Instagram posts via web
      return 'https://www.instagram.com/'
    }
  }

  const onSubmit = async (data: SightingFormData) => {
    // Check if submission is allowed
    if (!canSubmit) {
      setSubmitError('Please attempt to get your location first.')
      return
    }

    // Validate GPS coordinates are available (but allow submission without if attempted)
    if (!gpsCoordinates && !locationAttempted) {
      setSubmitError('Please try to get your location first.')
      return
    }

    // Validate compressed file is available
    if (!compressedFile) {
      setSubmitError('Image processing failed. Please try again.')
      return
    }

    // Validate social media share link is provided (required for coupon)
    if (!data.socialLink || !data.socialLink.trim()) {
      setSubmitError('Social media share required to receive your coupon code')
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      // Prepare form data for upload
      const formData = new FormData()
      formData.append('image', compressedFile)
      formData.append('fullName', data.fullName)
      formData.append('phoneNumber', data.phoneNumber)
      formData.append('email', data.email)
      if (data.zipCode) {
        formData.append('zipCode', data.zipCode)
      }
      formData.append('socialPlatform', data.socialPlatform)
      formData.append('socialLink', data.socialLink)
      
      // GPS coordinates are optional if location attempt was made
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
      setSightingId(result.sighting.id)
      setCouponCode(result.sighting.couponCode)
      setContestEligible(result.sighting.contestEligible)
      setSubmitSuccess(true)
    } catch (error) {
      console.error('Submit error:', error)
      setSubmitError(
        error instanceof Error ? error.message : 'Failed to submit sighting'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  if (submitSuccess) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <Card className="w-full max-w-2xl p-8 text-center">
          <h1 className="mb-6 text-4xl font-bold">
            SUCCESS! 🎉
          </h1>
          
          {/* Coupon Code Display */}
          <div className="mb-6 rounded-lg bg-gradient-to-r from-green-100 to-green-200 p-6 dark:from-green-900 dark:to-green-800">
            <p className="mb-2 text-sm font-medium text-green-800 dark:text-green-200">
              Your $20 Off Code:
            </p>
            <div className="flex items-center justify-center gap-3">
              <p className="text-4xl font-bold tracking-wider text-green-900 dark:text-green-100">
                {couponCode}
              </p>
              <Button
                onClick={handleCopyCoupon}
                size="sm"
                variant="outline"
                className="border-green-700 bg-white/50 hover:bg-white dark:border-green-300 dark:bg-green-950/50"
              >
                {copied ? (
                  <>
                    <Check className="mr-1 h-4 w-4" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="mr-1 h-4 w-4" />
                    Copy
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Book Now Section */}
          <div className="mb-6 space-y-3 rounded-lg border-2 border-blue-500 bg-blue-50 p-5 dark:border-blue-700 dark:bg-blue-950/30">
            <p className="text-center text-sm font-semibold text-blue-900 dark:text-blue-100">
              Ready to use your $20 off?
            </p>
            <Button
              size="lg"
              className="w-full bg-blue-600 text-lg font-semibold hover:bg-blue-700"
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
            <p className="text-center text-xs text-blue-700 dark:text-blue-300">
              Mention code <span className="font-bold">{couponCode}</span> when booking
            </p>
          </div>

          {/* Redemption Instructions */}
          <div className="mb-6 space-y-2 rounded-md border bg-muted/50 p-4">
            <p className="text-sm font-semibold">Other Ways to Redeem:</p>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm">
                Call{' '}
                <a href="tel:+17192498791" className="font-semibold text-blue-600 hover:underline">
                  (719) 249-8791
                </a>
                {' '}and mention your code.
              </p>
              <Button
                onClick={handleCopyPhone}
                size="sm"
                variant="outline"
              >
                {phoneCopied ? (
                  <>
                    <Check className="mr-1 h-3 w-3" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-1 h-3 w-3" />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Valid on any service.
            </p>
          </div>

          {/* Contest Entry Status */}
          <div className="mb-6 rounded-lg bg-yellow-100 p-4 dark:bg-yellow-900/30">
            <div className="mb-2 flex justify-center">
              <Trophy className="h-12 w-12 text-yellow-600" />
            </div>
            <p className="font-semibold text-yellow-800 dark:text-yellow-200">
              PLUS - You're entered in this month's drawing for a FREE whole house carpet cleaning (up to $350 value)!
            </p>
          </div>

          {/* Share Section - Boost Your Entry! */}
          <div className="mb-6 rounded-lg border-2 border-purple-500 bg-gradient-to-br from-purple-50 to-pink-50 p-6 dark:border-purple-700 dark:from-purple-950/30 dark:to-pink-950/30">
            <div className="mb-4 flex items-center justify-center gap-2">
              <Share2 className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              <h3 className="text-xl font-bold text-purple-900 dark:text-purple-100">
                Share Your Sighting!
              </h3>
            </div>
            <p className="mb-4 text-center text-sm text-purple-800 dark:text-purple-200">
              Share your photo on Facebook to show your friends and increase your chances in the drawing!
            </p>
            
            {/* Share Link Display */}
            <div className="mb-4 rounded-md bg-white p-3 dark:bg-gray-800">
              <p className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">Your Share Link:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 overflow-x-auto text-xs text-gray-800 dark:text-gray-200">
                  {`https://sightings.sasquatchcarpet.com/sightings/share/${sightingId}`}
                </code>
                <Button
                  onClick={handleCopyShareLink}
                  size="sm"
                  variant="outline"
                >
                  {shareLinkCopied ? (
                    <>
                      <Check className="h-4 w-4" />
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Facebook Share Button */}
            <Button
              onClick={handleFacebookShare}
              size="lg"
              className="w-full bg-[#1877F2] hover:bg-[#166FE5]"
            >
              <Share2 className="mr-2 h-5 w-5" />
              Share on Facebook
            </Button>
            <p className="mt-2 text-center text-xs text-purple-700 dark:text-purple-300">
              When you share, your photo will show up with your sighting!
            </p>
          </div>

          <Button onClick={() => window.location.reload()} size="lg" className="w-full">
            Submit Another Truck Photo
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center p-4 py-12">
      <div className="w-full max-w-2xl space-y-8">
        {/* Header */}
        <div className="text-center">
          {/* Logo */}
          <div className="mb-6 flex justify-center">
            <img 
              src="/sasquatch-logo.png" 
              alt="Sasquatch Carpet Cleaning" 
              className="h-24 w-auto"
            />
          </div>
          
          <h1 className="mb-4 text-4xl font-bold">
            Spotted Our Truck?
          </h1>
          <Card className="bg-gradient-to-r from-green-50 to-blue-50 p-6 dark:from-green-950 dark:to-blue-950">
            <div className="mb-3 flex justify-center">
              <Trophy className="h-12 w-12 text-yellow-500" />
            </div>
            <h2 className="mb-2 text-2xl font-bold">
              Report Your Truck Sighting & Win!
            </h2>
            <p className="text-lg">
              See our Sasquatch Carpet Cleaning truck in your neighborhood? Upload a photo, share on social media, and get an instant $20 off coupon + a chance to win a FREE whole house carpet cleaning (up to $350 value)!
            </p>
            <div className="mt-4 space-y-3">
              <div className="rounded-md bg-green-100 p-3 text-sm dark:bg-green-900/30">
                <p className="font-semibold text-green-800 dark:text-green-200">
                  📸 Photo + Social Share = $20 Coupon + Contest Entry
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Form */}
        <Card className="p-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Image Upload */}
            <div className="space-y-2">
              <Label htmlFor="image">
                <Camera className="mr-2 inline-block h-4 w-4" />
                Photo of Our Truck *
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
                <p className="text-sm text-destructive">
                  {String(errors.image.message)}
                </p>
              )}

              {/* Processing Indicator */}
              {isProcessingImage && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
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
              <div className="flex items-center justify-between rounded-md border bg-muted/50 p-3">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {gpsSource === 'exif' && '✓ Location detected'}
                    {gpsSource === 'device' && '✓ Location detected'}
                    {gpsSource === 'none' && !locationAttempted && 'Location needed'}
                    {gpsSource === 'none' && locationAttempted && 'Location attempt made'}
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
              {gpsSource === 'none' && locationAttempted && !gpsCoordinates && (
                <div className="rounded-md bg-yellow-50 p-3 text-sm dark:bg-yellow-950/30">
                  <p className="text-yellow-800 dark:text-yellow-200">
                    Location helps us verify your sighting! You can still submit without it.
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
                <p className="text-sm text-destructive">{errors.fullName.message}</p>
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
                <p className="text-sm text-destructive">{errors.phoneNumber.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Enter 10 digits - we'll format it for you
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
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                We'll contact you here if you win!
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
                <p className="text-sm text-destructive">{errors.zipCode.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Helps us serve your area better
              </p>
            </div>

            {/* Social Media Share Section */}
            <div className="space-y-3 rounded-lg border-2 border-red-300 bg-red-50/50 p-4 dark:border-red-700 dark:bg-red-950/20">
              <div className="flex items-center gap-2">
                <Share2 className="h-5 w-5 text-red-600" />
                <Label className="text-base font-semibold">
                  Share Your Photo (Required for $20 coupon) *
                </Label>
              </div>
              
              {/* Important Note - Moved to top */}
              <div className="rounded-md bg-yellow-100 p-3 text-sm dark:bg-yellow-900/30">
                <p className="font-semibold text-yellow-800 dark:text-yellow-200">
                  📝 Important:
                </p>
                <p className="mt-1 text-yellow-700 dark:text-yellow-300">
                  Upload your photo first, then share to social media and paste your post link below to claim your coupon.
                </p>
              </div>

              {/* Suggested Post Text */}
              <div className="space-y-2 rounded-md bg-white/70 p-3 dark:bg-black/20">
                <p className="text-xs font-semibold text-muted-foreground">
                  Copy this text for your post:
                </p>
                <p className="text-sm italic">
                  "I just spotted the Sasquatch Carpet Cleaning truck in [City]! 🚛 #SasquatchSighting"
                </p>
              </div>

              {/* Platform Selection */}
              <div className="space-y-2">
                <Label htmlFor="socialPlatform">
                  Share on: *
                </Label>
                <Select
                  onValueChange={(value) => setValue('socialPlatform', value as 'facebook' | 'instagram')}
                >
                  <SelectTrigger id="socialPlatform">
                    <SelectValue placeholder="Select platform" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="facebook">Facebook</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                  </SelectContent>
                </Select>
                {errors.socialPlatform && (
                  <p className="text-sm text-destructive">
                    {errors.socialPlatform.message}
                  </p>
                )}
              </div>

              {/* Share Button (only show when platform selected) */}
              {socialPlatform && (
                <Button
                  type="button"
                  onClick={() => window.open(generateShareUrl(socialPlatform), '_blank')}
                  className="w-full"
                  variant="outline"
                >
                  <Share2 className="mr-2 h-4 w-4" />
                  Share on {socialPlatform === 'facebook' ? 'Facebook' : 'Instagram'}
                </Button>
              )}

              {/* Social Link Input */}
              <div className="space-y-2">
                <Label htmlFor="socialLink">
                  Paste your post link here *
                </Label>
                <Input
                  id="socialLink"
                  type="url"
                  placeholder="https://www.facebook.com/... or https://www.instagram.com/..."
                  {...register('socialLink')}
                />
                {errors.socialLink && (
                  <p className="text-sm text-destructive">
                    {errors.socialLink.message}
                  </p>
                )}
              </div>
            </div>

            {/* Error Message */}
            {submitError && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {submitError}
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={isSubmitting || !canSubmit}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Submit Photo
                </>
              )}
            </Button>
            
            {/* Show helper text if submit is disabled */}
            {!canSubmit && imagePreview && gpsSource === 'none' && !locationAttempted && (
              <p className="text-center text-sm text-muted-foreground">
                Click "Use Current Location" to enable submission
              </p>
            )}
          </form>
        </Card>

        {/* Contest Rules */}
        <Card className="bg-muted/50 p-6">
          <h3 className="mb-3 text-lg font-semibold">Contest Rules:</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-foreground">•</span>
              <span>Monthly drawing for one winner</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-foreground">•</span>
              <span>Prize: Whole house carpet cleaning (up to $350 value)</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-foreground">•</span>
              <span>$20 coupon valid on services $150 or more</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-foreground">•</span>
              <span>Must be 18+ to enter</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-foreground">•</span>
              <span>No purchase necessary to enter drawing</span>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
