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
import { Camera, Upload, MapPin, Loader2 } from 'lucide-react'
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
      (files) => files instanceof FileList && files.length > 0,
      'Image is required'
    )
    .refine(
      (files) => files instanceof FileList && files[0]?.type.startsWith('image/'),
      'File must be an image'
    ),
  serviceId: z.string().min(1, 'Service type is required'),
  voiceNote: z.string().optional(),
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

  const onSubmit = async (data: UploadFormData) => {
    // Validate GPS coordinates are available
    if (!gpsCoordinates) {
      setUploadError('GPS coordinates are required. Please use current location.')
      return
    }

    // Validate compressed file is available
    if (!compressedFile) {
      setUploadError('Image processing failed. Please try again.')
      return
    }

    setIsUploading(true)
    setUploadError(null)

    try {
      // Prepare form data for upload
      const formData = new FormData()
      formData.append('image', compressedFile)
      formData.append('serviceId', data.serviceId)
      formData.append('gpsLat', gpsCoordinates.lat.toString())
      formData.append('gpsLng', gpsCoordinates.lng.toString())
      
      if (data.voiceNote) {
        formData.append('voiceNote', data.voiceNote)
      }

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
      console.log('Job created successfully:', result.job)

      // Reset form after short delay
      setTimeout(() => {
        window.location.reload()
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
          capture="environment"
          {...register('image')}
          className="cursor-pointer file:cursor-pointer"
          disabled={isProcessingImage}
        />
        {errors.image && (
          <p className="text-sm text-destructive">{errors.image.message}</p>
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

      {/* Voice Note Text Field */}
      <div className="space-y-2">
        <Label htmlFor="voiceNote">Voice Note (Optional)</Label>
        <Textarea
          id="voiceNote"
          placeholder="Add notes about this job..."
          rows={4}
          {...register('voiceNote')}
        />
        <p className="text-xs text-muted-foreground">
          Voice input will be added in a future update
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
          ✓ Job created successfully! Redirecting...
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
            Uploading...
          </>
        ) : (
          <>
            <Upload className="mr-2 h-4 w-4" />
            Create Job
          </>
        )}
      </Button>
    </form>
  )
}
