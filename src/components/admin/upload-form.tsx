'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { createClient } from '@/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Camera, Upload, MapPin, Loader2, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import {
  extractExifGps,
  compressImage,
  getCurrentLocation,
  type GpsCoordinates,
} from '@/lib/image-utils'

// Form validation schema - using z.any() with runtime checks to avoid SSR FileList error
const uploadFormSchema = z.object({
  image: z
    .any()
    .refine(
      (files) => {
        // Allow empty FileList if we have a preloaded/compressed file
        return (files instanceof FileList && files.length > 0) || files === undefined
      },
      'Image is required'
    )
    .refine(
      (files) => {
        // Skip type check if no files (preloaded image scenario)
        if (!files || (files instanceof FileList && files.length === 0)) {
          return true
        }
        return files instanceof FileList && files[0]?.type.startsWith('image/')
      },
      'File must be an image'
    ),
  serviceId: z.string().min(1, 'Service type is required'),
  description: z.string().min(10, 'Description is required (minimum 10 characters)'),
})

type UploadFormData = z.infer<typeof uploadFormSchema>

type Service = {
  id: string
  name: string
  slug: string
}

export function UploadForm() {
  const [services, setServices] = useState<Service[]>([])
  const [isLoadingServices, setIsLoadingServices] = useState(true)
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
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const [showManualGps, setShowManualGps] = useState(false)
  const [manualCoords, setManualCoords] = useState<string>('')
  const [manualGpsError, setManualGpsError] = useState<string | null>(null)
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<UploadFormData>({
    resolver: zodResolver(uploadFormSchema),
  })

  const imageFiles = watch('image')

  // Fetch services from Supabase
  useEffect(() => {
    async function fetchServices() {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('services')
        .select('id, name, slug')
        .order('name')

      if (error) {
        console.error('Error fetching services:', error)
      } else {
        setServices(data || [])
      }
      setIsLoadingServices(false)
    }

    fetchServices()
  }, [])

  // Check for preloaded image from Before/After tool
  useEffect(() => {
    const preloadedImageData = sessionStorage.getItem('preloadedImage')
    if (preloadedImageData) {
      // Convert data URL to File
      fetch(preloadedImageData)
        .then(res => res.blob())
        .then(async blob => {
          const file = new File([blob], `combined-${Date.now()}.jpg`, { type: 'image/jpeg' })
          
          // Set the image preview
          setImagePreview(preloadedImageData)
          
          // Set compressed file (already compressed by Before/After tool)
          setCompressedFile(file)
          
          // Combined images don't have GPS, so user will need to add manually
          setGpsCoordinates(null)
          setGpsSource('none')
          
          // Clear sessionStorage
          sessionStorage.removeItem('preloadedImage')
          
          console.log('✅ Loaded combined image from Before/After tool (ready to upload)')
        })
        .catch(err => {
          console.error('Failed to load preloaded image:', err)
        })
    }
  }, [])

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
        // STEP 1: Extract EXIF GPS data BEFORE compression (per .cursorrules)
        const gps = await extractExifGps(file)
        if (gps) {
          setGpsCoordinates(gps)
          setGpsSource('exif')
        } else {
          setGpsCoordinates(null)
          setGpsSource('none')
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
    try {
      const location = await getCurrentLocation()
      if (location) {
        setGpsCoordinates(location)
        setGpsSource('device')
      } else {
        alert('Unable to get your location. Please check location permissions.')
      }
    } catch (error) {
      console.error('Error getting location:', error)
      alert('Error getting location')
    } finally {
      setIsGettingLocation(false)
    }
  }

  // Handle manual GPS coordinates
  const handleManualGpsApply = () => {
    setManualGpsError(null)

    // Validate input
    if (!manualCoords.trim()) {
      setManualGpsError('Please enter coordinates')
      return
    }

    // Parse comma-separated coordinates (handles both "lat, lng" and "lat,lng")
    const parts = manualCoords.split(',').map(part => part.trim())

    if (parts.length !== 2) {
      setManualGpsError('Invalid format. Use: latitude, longitude (e.g., 38.9072, -104.8586)')
      return
    }

    const lat = parseFloat(parts[0])
    const lng = parseFloat(parts[1])

    // Check if valid numbers
    if (isNaN(lat) || isNaN(lng)) {
      setManualGpsError('Please enter valid decimal numbers')
      return
    }

    // Validate latitude range (-90 to 90)
    if (lat < -90 || lat > 90) {
      setManualGpsError('Latitude must be between -90 and 90')
      return
    }

    // Validate longitude range (-180 to 180)
    if (lng < -180 || lng > 180) {
      setManualGpsError('Longitude must be between -180 and 180')
      return
    }

    // Set manual coordinates
    setGpsCoordinates({ lat, lng })
    setGpsSource('device') // Use 'device' as source for manual entry
    setManualGpsError(null)
  }

  // Generate AI description using Gemini
  const handleGenerateDescription = async () => {
    const serviceId = watch('serviceId')
    const currentDescription = watch('description')

    // Validate required fields
    if (!serviceId) {
      setGenerationError('Please select a service type first')
      return
    }

    if (!gpsCoordinates) {
      setGenerationError('Please add location data first')
      return
    }

    setIsGeneratingDescription(true)
    setGenerationError(null)

    try {
      // Get service name
      const selectedService = services.find((s) => s.id === serviceId)
      if (!selectedService) {
        throw new Error('Service not found')
      }

      // Call API to generate description
      const response = await fetch('/api/generate-description', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          serviceType: selectedService.name,
          city: 'Colorado Springs', // Will be updated with actual geocoded city
          notes: currentDescription || '', // Include any existing text as notes
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to generate description')
      }

      // Set generated description
      setValue('description', result.description)
    } catch (error) {
      console.error('Generate description error:', error)
      setGenerationError(
        error instanceof Error ? error.message : 'Failed to generate description'
      )
    } finally {
      setIsGeneratingDescription(false)
    }
  }

  const onSubmit = async (data: UploadFormData) => {
    // Validate GPS coordinates are available
    if (!gpsCoordinates) {
      setUploadError('GPS coordinates are required. Please use current location.')
      return
    }

    // Validate that we have EITHER a file input OR a preloaded compressed file
    const hasFileInput = data.image instanceof FileList && data.image.length > 0
    const hasPreloadedFile = compressedFile !== null

    if (!hasFileInput && !hasPreloadedFile) {
      setUploadError('Image is required. Please select an image or use the Before/After tool.')
      return
    }

    // If we have file input but no compressed file yet, something went wrong
    if (hasFileInput && !compressedFile) {
      setUploadError('Image processing failed. Please try again.')
      return
    }

    setIsUploading(true)
    setUploadError(null)

    try {
      // TypeScript safety: Ensure compressedFile is not null
      if (!compressedFile) {
        throw new Error('No image file available')
      }

      // Prepare form data for upload
      const formData = new FormData()
      formData.append('image', compressedFile)
      formData.append('serviceId', data.serviceId)
      formData.append('gpsLat', gpsCoordinates.lat.toString())
      formData.append('gpsLng', gpsCoordinates.lng.toString())
      formData.append('description', data.description)

      // Send to API
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Upload failed')
      }

      // Success!
      setUploadSuccess(true)
      console.log('Job published successfully:', result.job)

      // Redirect to homepage to see the published job on the map
      setTimeout(() => {
        window.location.href = '/'
      }, 2000)
    } catch (error) {
      console.error('Upload error:', error)
      setUploadError(
        error instanceof Error ? error.message : 'Failed to upload job'
      )
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Image Capture */}
      <div className="space-y-2">
        <Label htmlFor="image">
          <Camera className="mr-2 inline-block h-4 w-4" />
          Job Photo
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
          <p className="text-sm text-destructive">{String(errors.image.message)}</p>
        )}

        {/* Processing Indicator */}
        {isProcessingImage && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Processing image (extracting GPS, compressing)...
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
            <div className="flex items-center justify-between rounded-md border bg-muted/50 p-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                <span className="text-sm font-medium">
                  {gpsSource === 'exif' && 'GPS: Found in photo'}
                  {gpsSource === 'device' && 'GPS: Using device location'}
                  {gpsSource === 'none' && 'GPS: Not available'}
                </span>
              </div>

              {/* Show "Use Current Location" button if no GPS */}
              {gpsSource === 'none' && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleUseCurrentLocation}
                  disabled={isGettingLocation}
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

            {/* Show GPS coordinates for debugging */}
            {gpsCoordinates && (
              <p className="text-xs text-muted-foreground">
                Coordinates: {gpsCoordinates.lat.toFixed(6)},{' '}
                {gpsCoordinates.lng.toFixed(6)}
              </p>
            )}

            {/* Manual GPS Override Section */}
            <div className="mt-3 space-y-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowManualGps(!showManualGps)}
                className="flex w-full items-center justify-between p-2 text-sm"
              >
                <span className="font-medium">Manual Location Override</span>
                {showManualGps ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>

              {showManualGps && (
                <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                  <div className="space-y-2">
                    <Label htmlFor="manualCoords" className="text-sm">
                      Manual Coordinates
                    </Label>
                    <Input
                      id="manualCoords"
                      type="text"
                      placeholder="Paste from Google Maps (e.g., 38.9072, -104.8586)"
                      value={manualCoords}
                      onChange={(e) => setManualCoords(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Format: latitude, longitude
                    </p>
                  </div>

                  {manualGpsError && (
                    <p className="text-xs text-destructive">{manualGpsError}</p>
                  )}

                  <Button
                    type="button"
                    size="sm"
                    onClick={handleManualGpsApply}
                    className="w-full"
                  >
                    Apply Manual Coordinates
                  </Button>

                  <p className="text-xs text-muted-foreground">
                    Need help?{' '}
                    <a
                      href="https://www.google.com/maps"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      Get coordinates from Google Maps
                    </a>
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Service Type Dropdown */}
      <div className="space-y-2">
        <Label htmlFor="service">Service Type</Label>
        <Select
          onValueChange={(value) => setValue('serviceId', value)}
          disabled={isLoadingServices}
        >
          <SelectTrigger id="service">
            <SelectValue
              placeholder={
                isLoadingServices ? 'Loading services...' : 'Select a service'
              }
            />
          </SelectTrigger>
          <SelectContent>
            {services.map((service) => (
              <SelectItem key={service.id} value={service.id}>
                {service.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.serviceId && (
          <p className="text-sm text-destructive">{errors.serviceId.message}</p>
        )}
      </div>

      {/* Description Field */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="description">Description *</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleGenerateDescription}
            disabled={isGeneratingDescription || !watch('serviceId')}
          >
            {isGeneratingDescription ? (
              <>
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-3 w-3" />
                Generate with AI
              </>
            )}
          </Button>
        </div>
        <Textarea
          id="description"
          placeholder="Describe the work completed, challenges overcome, and results achieved..."
          rows={6}
          {...register('description')}
        />
        {errors.description && (
          <p className="text-sm text-destructive">{errors.description.message}</p>
        )}
        {generationError && (
          <p className="text-sm text-destructive">{generationError}</p>
        )}
        <p className="text-xs text-muted-foreground">
          This description will appear on the public job page. Use AI to generate a professional description, then edit as needed.
        </p>
      </div>

      {/* Error Message */}
      {uploadError && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {uploadError}
        </div>
      )}

      {/* Success Message */}
      {uploadSuccess && (
        <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
          ✓ Job published successfully! Redirecting to map...
        </div>
      )}

      {/* Submit Button */}
      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={isUploading || uploadSuccess}
      >
        {isUploading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Publishing...
          </>
        ) : (
          <>
            <Upload className="mr-2 h-4 w-4" />
            Publish Job
          </>
        )}
      </Button>
    </form>
  )
}
