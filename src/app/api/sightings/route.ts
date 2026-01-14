/**
 * Sightings API Route Handler
 * Handles public contest submissions: image upload, coupon generation, and sighting record creation
 * No authentication required (public contest)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'
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
    const email = formData.get('email') as string
    const gpsLat = formData.get('gpsLat') as string | null
    const gpsLng = formData.get('gpsLng') as string | null
    const socialPlatform = formData.get('socialPlatform') as string | null
    const socialLink = formData.get('socialLink') as string | null

    // Validate required fields
    if (!imageFile || !email || !socialPlatform || !socialLink) {
      return NextResponse.json(
        { error: 'Image, email, social platform, and social link are required' },
        { status: 400 }
      )
    }

    // Validate social platform value
    if (socialPlatform !== 'facebook' && socialPlatform !== 'instagram') {
      return NextResponse.json(
        { error: 'Invalid social platform' },
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

    // Generate unique filename
    const timestamp = Date.now()
    const filename = `${timestamp}-${imageFile.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`

    // Create Supabase client (no auth required for public submissions)
    const supabase = await createClient()

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

    // Since social link is now required, everyone is contest eligible
    const contestEligible = true

    // Insert sighting record into database
    const { data: sighting, error: insertError } = await supabase
      .from('sightings')
      .insert({
        image_url: publicUrl,
        image_filename: filename,
        gps_lat: lat,
        gps_lng: lng,
        email,
        social_platform: socialPlatform,
        social_link: socialLink,
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

    // Return success with sighting details including coupon code
    return NextResponse.json(
      {
        success: true,
        sighting: {
          id: sighting.id,
          couponCode: sighting.coupon_code,
          contestEligible: sighting.contest_eligible,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Sightings API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
