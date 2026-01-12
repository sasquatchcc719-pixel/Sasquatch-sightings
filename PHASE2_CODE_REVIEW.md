# Phase 2 Code Review - EXIF Extraction & Image Compression

This document contains the complete code for Phase 2 implementation for review.

---

## File 1: `/src/lib/image-utils.ts`

```typescript
/**
 * Image utility functions for EXIF extraction and compression
 * Per .cursorrules: Extract EXIF BEFORE compression (compression strips metadata)
 */

import exifr from 'exifr'
import imageCompression from 'browser-image-compression'

export type GpsCoordinates = {
  lat: number
  lng: number
}

/**
 * Extract GPS coordinates from image EXIF data
 * Returns null if no GPS data is found
 * @param file - Image file to extract GPS from
 */
export async function extractExifGps(
  file: File
): Promise<GpsCoordinates | null> {
  try {
    // Parse EXIF data from the image file
    const exifData = await exifr.parse(file, {
      gps: true, // Only parse GPS-related tags
      pick: ['latitude', 'longitude'], // Only extract what we need
    })

    // Check if GPS coordinates exist
    if (
      exifData &&
      typeof exifData.latitude === 'number' &&
      typeof exifData.longitude === 'number'
    ) {
      return {
        lat: exifData.latitude,
        lng: exifData.longitude,
      }
    }

    return null
  } catch (error) {
    console.error('Error extracting EXIF GPS data:', error)
    return null
  }
}

/**
 * Compress image file to max 500KB
 * Uses browser-image-compression library
 * @param file - Image file to compress
 */
export async function compressImage(file: File): Promise<File> {
  try {
    const options = {
      maxSizeMB: 0.5, // 500KB max
      maxWidthOrHeight: 1920, // Max dimension
      useWebWorker: true, // Use web worker for better performance
      fileType: file.type as 'image/jpeg' | 'image/png' | 'image/webp', // Preserve file type
    }

    const compressedFile = await imageCompression(file, options)

    // Return compressed file with original name
    return new File([compressedFile], file.name, {
      type: compressedFile.type,
      lastModified: Date.now(),
    })
  } catch (error) {
    console.error('Error compressing image:', error)
    // If compression fails, return original file
    return file
  }
}

/**
 * Get current device location using browser Geolocation API
 * Returns null if geolocation is not available or user denies permission
 */
export async function getCurrentLocation(): Promise<GpsCoordinates | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      console.error('Geolocation is not supported by this browser')
      resolve(null)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        })
      },
      (error) => {
        console.error('Error getting current location:', error)
        resolve(null)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    )
  })
}
```

---

## File 2: `/src/components/admin/upload-form.tsx`

```typescript
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

// Form validation schema
const uploadFormSchema = z.object({
  image: z
    .instanceof(FileList)
    .refine((files) => files.length > 0, 'Image is required')
    .refine(
      (files) => files[0]?.type.startsWith('image/'),
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

  const onSubmit = (data: UploadFormData) => {
    console.log('Form submitted:', {
      image: {
        name: compressedFile?.name || data.image[0]?.name,
        size: compressedFile?.size || data.image[0]?.size,
        type: compressedFile?.type || data.image[0]?.type,
        originalSize: data.image[0]?.size,
        compressedSize: compressedFile?.size,
      },
      gpsCoordinates,
      gpsSource,
      serviceId: data.serviceId,
      voiceNote: data.voiceNote,
    })
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

      {/* Submit Button */}
      <Button type="submit" className="w-full" size="lg">
        <Upload className="mr-2 h-4 w-4" />
        Create Job (Console Log)
      </Button>
    </form>
  )
}
```

---

## Implementation Summary

### ✅ Requirements Met:

1. **EXIF Extraction** (`extractExifGps`)
   - Uses `exifr` library
   - Extracts GPS coordinates from photo metadata
   - Returns null if no GPS data found

2. **Image Compression** (`compressImage`)
   - Uses `browser-image-compression`
   - Compresses to max 500KB
   - Preserves file type and name

3. **Correct Processing Order** (per .cursorrules)
   - ✅ STEP 1: Extract EXIF BEFORE compression
   - ✅ STEP 2: Compress image AFTER extraction
   - ✅ STEP 3: Generate preview

4. **GPS Status Indicator**
   - Shows "GPS: Found in photo" (from EXIF)
   - Shows "GPS: Using device location" (from browser)
   - Shows "GPS: Not available" with action button

5. **Device Location Fallback**
   - "Use Current Location" button appears when no EXIF GPS
   - Uses browser Geolocation API
   - High accuracy mode enabled

6. **Console Logging**
   - Logs compressed file info
   - Logs GPS coordinates and source
   - Shows compression ratio (original vs compressed)

### 📦 Dependencies Added:
- `exifr` (v7.1.3) - EXIF parser

### 🚫 NOT Implemented (As Requested):
- Server upload logic
- Database insertion
- Additional packages beyond exifr

---

## Ready for Review
This code is ready for analysis and follows all .cursorrules requirements.
