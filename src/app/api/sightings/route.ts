/**
 * Sightings API Route Handler
 * Handles public contest submissions: image upload, coupon generation, and sighting record creation
 * No authentication required (public contest)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'
import { reverseGeocode } from '@/lib/geocode'
import { generateSightingSEOFilename } from '@/lib/seo-filename'
import sharp from 'sharp'

// Generate unique coupon code in format SCC-XXXX
function generateCouponCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return `SCC-${code}`
}

export async function POST(request: NextRequest) {
  try {
    // Parse form data
    const formData = await request.formData()
    const imageFile = formData.get('image') as File
    const fullName = formData.get('fullName') as string
    const phoneNumber = formData.get('phoneNumber') as string
    const email = formData.get('email') as string
    const zipCode = formData.get('zipCode') as string | null
    const gpsLat = formData.get('gpsLat') as string | null
    const gpsLng = formData.get('gpsLng') as string | null

    // Validate required fields (social fields are now optional)
    if (!imageFile || !fullName || !phoneNumber || !email) {
      return NextResponse.json(
        { error: 'Image, full name, phone number, and email are required' },
        { status: 400 }
      )
    }



    // Parse GPS coordinates (optional - may be null)
    let lat: number | null = null
    let lng: number | null = null

    if (gpsLat && gpsLng) {
      lat = parseFloat(gpsLat)
      lng = parseFloat(gpsLng)

      // Validate coordinates if provided
      if (isNaN(lat) || isNaN(lng)) {
        return NextResponse.json(
          { error: 'Invalid GPS coordinates' },
          { status: 400 }
        )
      }
    }

    // Convert File to Buffer for Sharp processing
    const arrayBuffer = await imageFile.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Optimize image with Sharp (server-side optimization)
    const optimizedBuffer = await sharp(buffer)
      .resize(1920, 1920, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer()

    // Create Supabase client (no auth required for public submissions)
    const supabase = await createClient()

    // Reverse geocode GPS coordinates to get city and state (for SEO filename)
    let city: string | null = null
    let state: string | null = null
    
    if (lat !== null && lng !== null) {
      try {
        const geocodeResult = await reverseGeocode(lat, lng)
        city = geocodeResult.city
        state = geocodeResult.state
      } catch (error) {
        console.error('Geocoding error:', error)
        // Continue without location data if geocoding fails
      }
    }

    // Generate SEO-friendly filename
    // Format: sasquatch-sighting-in-{city}-{state}-{timestamp}.jpg
    // Example: sasquatch-sighting-in-denver-co-1705634892.jpg
    const filename = generateSightingSEOFilename(
      city,
      state,
      imageFile.name
    )

    // Upload optimized image to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('sighting-images')
      .upload(filename, optimizedBuffer, {
        contentType: 'image/jpeg',
        upsert: false,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json(
        { error: 'Failed to upload image' },
        { status: 500 }
      )
    }

    // Get public URL for the uploaded image
    const {
      data: { publicUrl },
    } = supabase.storage.from('sighting-images').getPublicUrl(filename)

    // Generate unique coupon code
    let couponCode = generateCouponCode()
    let isUnique = false
    let attempts = 0
    const maxAttempts = 10

    // Ensure coupon code is unique
    while (!isUnique && attempts < maxAttempts) {
      const { data: existingCoupon } = await supabase
        .from('sightings')
        .select('coupon_code')
        .eq('coupon_code', couponCode)
        .single()

      if (!existingCoupon) {
        isUnique = true
      } else {
        couponCode = generateCouponCode()
        attempts++
      }
    }

    if (!isUnique) {
      return NextResponse.json(
        { error: 'Failed to generate unique coupon code. Please try again.' },
        { status: 500 }
      )
    }

    // Contest eligible by default for all valid submissions (Google Maps Pivot)
    const contestEligible = true

    // Insert sighting record into database
    const { data: sighting, error: insertError } = await supabase
      .from('sightings')
      .insert({
        image_url: publicUrl,
        image_filename: filename,
        gps_lat: lat,
        gps_lng: lng,
        city,
        state,
        full_name: fullName,
        phone_number: phoneNumber,
        email,
        zip_code: zipCode || null,
        // social_platform: null, // Removed
        // social_link: null, // Removed
        coupon_code: couponCode,
        contest_eligible: contestEligible,
        coupon_redeemed: false,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Database insert error:', insertError)
      return NextResponse.json(
        { error: 'Failed to create sighting record' },
        { status: 500 }
      )
    }

    // Trigger Zapier webhook for instant Google posting
    try {
      if (process.env.ZAPIER_WEBHOOK_URL) {
        await fetch(process.env.ZAPIER_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            // Mapped to match Zapier requirements
            service: 'Sasquatch Sighting',
            neighborhood: zipCode || 'Unknown',
            photo_url: publicUrl,

            // Keeping these for debug/completeness
            full_name: fullName,
            email: email
          })
        });
      }
    } catch (error) {
      // Log error but don't fail the request
      console.error('Zapier webhook failed:', error);
    }

    // Return success with coupon
    return NextResponse.json({
      success: true,
      message: 'Sighting logged successfully',
      data: sighting,
      couponCode: 'SASQUATCH2026',
    }, { status: 201 })

  } catch (error) {
    console.error('Error logging sighting:', error)
    return NextResponse.json(
      { error: 'Failed to log sighting' },
      { status: 500 }
    )
  }
}
