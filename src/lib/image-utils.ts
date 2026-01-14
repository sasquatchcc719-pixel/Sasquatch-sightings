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
        // Geolocation error codes:
        // 1 = PERMISSION_DENIED
        // 2 = POSITION_UNAVAILABLE
        // 3 = TIMEOUT
        const errorMessages: Record<number, string> = {
          1: 'User denied location permission',
          2: 'Location unavailable',
          3: 'Location request timed out',
        }
        console.warn(
          'Location access:',
          errorMessages[error.code] || error.message
        )
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
