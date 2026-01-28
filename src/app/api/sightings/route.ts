/**
 * Sightings API Route Handler
 * Handles public contest submissions: image upload, coupon generation, and sighting record creation
 * No authentication required (public contest)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/supabase/server'
import { reverseGeocode } from '@/lib/geocode'
import { generateSightingSEOFilename } from '@/lib/seo-filename'
import { sendOneSignalNotification } from '@/lib/onesignal'
import { sendAdminSMS, sendCustomerSMS } from '@/lib/twilio'
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
    const imageFile = formData.get('image') as File | null
    const fullName = formData.get('fullName') as string
    const phoneNumber = formData.get('phoneNumber') as string
    const email = formData.get('email') as string
    const zipCode = formData.get('zipCode') as string | null
    const locationText = formData.get('locationText') as string | null
    const gpsLat = formData.get('gpsLat') as string | null
    const gpsLng = formData.get('gpsLng') as string | null

    // Validate required fields (image is now optional)
    if (!fullName || !phoneNumber || !email) {
      return NextResponse.json(
        { error: 'Full name, phone number, and email are required' },
        { status: 400 },
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
          { status: 400 },
        )
      }
    }

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

    // Handle image upload (optional)
    let publicUrl: string | null = null
    let filename: string | null = null

    if (imageFile && imageFile.size > 0) {
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

      // Generate SEO-friendly filename
      filename = generateSightingSEOFilename(city, state, imageFile.name)

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
          { status: 500 },
        )
      }

      // Get public URL for the uploaded image
      const { data } = supabase.storage
        .from('sighting-images')
        .getPublicUrl(filename)
      publicUrl = data.publicUrl
    }

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
        { status: 500 },
      )
    }

    // Contest eligible by default for all valid submissions (Google Maps Pivot)
    const contestEligible = true

    // Determine if this entry gets extra contest entry (has photo)
    const hasPhoto = publicUrl !== null

    // Insert sighting record into database
    const { data: sighting, error: insertError } = await supabase
      .from('sightings')
      .insert({
        image_url: publicUrl,
        image_filename: filename,
        gps_lat: lat,
        gps_lng: lng,
        city: city || (locationText ? locationText.substring(0, 100) : null), // Use locationText as fallback for city
        state,
        full_name: fullName,
        phone_number: phoneNumber,
        email,
        zip_code: zipCode || null,
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
        { status: 500 },
      )
    }

    // Also add to leads table for unified lead tracking (use admin client to bypass RLS)
    let leadId: string | undefined
    try {
      const adminClient = createAdminClient()
      const leadLocation = locationText || city || null
      const { data: leadData, error: leadError } = await adminClient
        .from('leads')
        .insert({
          source: 'contest',
          sighting_id: sighting.id, // Link to sighting for cascade delete
          name: fullName,
          phone: phoneNumber,
          email: email,
          location: leadLocation,
          status: 'new',
          notes: hasPhoto ? 'Submitted with photo' : 'No photo submitted',
        })
        .select('id')
        .single()

      if (leadError) {
        console.error('Failed to create lead:', leadError)
      } else if (leadData) {
        leadId = leadData.id
        console.log('Lead created from contest entry:', leadId)
      }
    } catch (leadError) {
      // Log but don't fail - sighting was already saved
      console.error('Failed to create lead from sighting:', leadError)
    }

    // Send notifications for new contest entry
    // OneSignal (backup - for desktop browser notifications)
    await sendOneSignalNotification({
      heading: '🏆 New Contest Entry',
      content: `${fullName} entered the contest${hasPhoto ? ' with photo' : ''}`,
      data: {
        type: 'contest_entry',
        sighting_id: sighting.id,
        has_photo: hasPhoto,
        location: locationText || city || 'Unknown',
      },
    })

    // Twilio SMS (primary notification method)
    const locationStr = locationText || city || 'Unknown location'

    // Send admin notification
    await sendAdminSMS(
      `🏆 New Contest Entry\n${fullName} - ${phoneNumber}\n${locationStr}${hasPhoto ? ' (with photo)' : ''}`,
      'contest_entry_admin',
    )

    // Send customer auto-response with booking link and coupon
    await sendCustomerSMS(
      phoneNumber,
      `Thanks for entering the Sasquatch contest! 🦶\nBook your carpet cleaning now and get $20 off:\nhttps://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true\nUse coupon: SCC20 (add to notes when booking)\nQuestions? Call (719) 249-8791`,
      leadId,
      'contest_entry',
    )

    // Return success with coupon
    return NextResponse.json(
      {
        success: true,
        message: 'Sighting logged successfully',
        data: sighting,
        couponCode: 'SCC20',
      },
      { status: 201 },
    )
  } catch (error) {
    console.error('Error logging sighting:', error)
    return NextResponse.json(
      { error: 'Failed to log sighting' },
      { status: 500 },
    )
  }
}
