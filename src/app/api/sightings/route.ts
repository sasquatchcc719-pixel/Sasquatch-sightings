/**
 * Sightings API Route Handler
 * Handles public contest submissions: image upload, coupon generation, and sighting record creation
 * No authentication required (public contest)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import {
  signSightingSubmission,
  SIGHTING_SUBMISSION_COOKIE,
  SIGHTING_SUBMISSION_MAX_AGE,
} from '@/lib/sighting-submission'
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
    const partnerId = formData.get('partnerId') as string | null
    const smsConsentRaw = formData.get('smsConsent')
    const smsConsent = smsConsentRaw === 'true'
    console.log(
      '[Contest] smsConsent form value:',
      smsConsentRaw,
      '→',
      smsConsent,
    )

    // Validate required fields (image is now optional)
    if (
      typeof fullName !== 'string' ||
      !fullName.trim() ||
      fullName.length > 200 ||
      typeof phoneNumber !== 'string' ||
      !/^[+()\d\s.-]{7,32}$/.test(phoneNumber) ||
      typeof email !== 'string' ||
      email.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      [zipCode, locationText, gpsLat, gpsLng, partnerId].some(
        (value) =>
          value !== null && (typeof value !== 'string' || value.length > 500),
      ) ||
      (partnerId &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          partnerId,
        )) ||
      (imageFile &&
        (typeof imageFile === 'string' || imageFile.size > 10 * 1024 * 1024))
    ) {
      return NextResponse.json(
        { error: 'Provide valid contact information and an image under 10 MB' },
        { status: 400 },
      )
    }

    // Parse GPS coordinates (optional - may be null)
    let lat: number | null = null
    let lng: number | null = null

    if (gpsLat || gpsLng) {
      lat = gpsLat ? Number(gpsLat) : NaN
      lng = gpsLng ? Number(gpsLng) : NaN

      // Validate coordinates if provided
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      ) {
        return NextResponse.json(
          { error: 'Invalid GPS coordinates' },
          { status: 400 },
        )
      }
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'Submission verification is not configured' },
        { status: 503 },
      )
    }

    // Validated public intake writes only the server-owned submission fields.
    const supabase = createAdminClient()

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
      .select('id')
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
          partner_id: partnerId || null,
        })
        .select('id')
        .single()

      if (leadError) {
        console.error('Failed to create lead:', leadError)
      } else if (leadData) {
        leadId = leadData.id
        console.log('Lead created from contest entry:', leadId)

        // If partner info is present, increment their conversion count
        if (partnerId) {
          try {
            await adminClient.rpc('increment_partner_conversions', {
              partner_id: partnerId,
            })
          } catch (err) {
            // Fallback if RPC doesn't exist, try direct update
            try {
              const { data: pData } = await adminClient
                .from('partners')
                .select('total_conversions')
                .eq('id', partnerId)
                .single()

              if (pData) {
                await adminClient
                  .from('partners')
                  .update({
                    total_conversions: (pData.total_conversions || 0) + 1,
                  })
                  .eq('id', partnerId)
              }
            } catch (e) {
              console.error('Failed to update partner stats:', e)
            }
          }
        }
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

    // Define the welcome message for both SMS and Chatbot memory (only sent if express SMS consent)
    const welcomeMessage = `Thanks for entering the Sasquatch contest! 🦶\nReply to this text to get a quote and book your $20 off cleaning — we'll handle everything right here!\nUse code SCC20 when booking.\nQuestions? Call (719) 249-8791`

    if (smsConsent) {
      console.log(
        '[Contest] SMS consent true, sending welcome SMS to',
        phoneNumber,
      )
      await sendCustomerSMS(
        phoneNumber,
        welcomeMessage,
        leadId,
        'contest_entry',
      )
    } else {
      console.log(
        '[Contest] SMS consent false or missing, skipping welcome SMS',
      )
    }

    // INITIALIZE HARRY AI CONVERSATION (only when they opted in to SMS so we have consent to message)
    if (smsConsent) {
      try {
        const adminClient = createAdminClient()

        // Simplify phone to E.164 if needed (though sendCustomerSMS handles it, we need it for DB)
        const digits = phoneNumber.replace(/\D/g, '')
        const normalizedPhone =
          digits.length === 10
            ? `+1${digits}`
            : digits.startsWith('+')
              ? digits
              : `+${digits}`

        // Check if conversation exists (prevent duplicate active convos)
        const { data: existingConvo } = await adminClient
          .from('conversations')
          .select('id')
          .eq('phone_number', normalizedPhone)
          .eq('status', 'active')
          .single()

        if (!existingConvo) {
          await adminClient.from('conversations').insert({
            phone_number: normalizedPhone,
            source: 'Contest',
            status: 'active',
            ai_enabled: true,
            lead_id: leadId || null,
            messages: [
              {
                role: 'assistant',
                content: welcomeMessage,
                timestamp: new Date().toISOString(),
                metadata: { type: 'contest_welcome' },
              },
            ],
            metadata: {
              coupon_code: 'SCC20',
              contest_entry: true,
              entered_at: new Date().toISOString(),
            },
          })
          console.log('✅ Initialized Harry conversation for contest entry')
        } else {
          console.log(
            'ℹ️ Active conversation already exists, skipping initialization',
          )
        }
      } catch (convoError) {
        console.error('Failed to initialize Harry conversation:', convoError)
      }
    }

    // Return success with coupon
    const response = NextResponse.json(
      {
        success: true,
        message: 'Sighting logged successfully',
        data: { id: sighting.id },
        couponCode: 'SCC20',
      },
      { status: 201 },
    )
    response.cookies.set(
      SIGHTING_SUBMISSION_COOKIE,
      signSightingSubmission(sighting.id),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/sightings',
        maxAge: SIGHTING_SUBMISSION_MAX_AGE,
      },
    )
    return response
  } catch (error) {
    console.error('Error logging sighting:', error)
    return NextResponse.json(
      { error: 'Failed to log sighting' },
      { status: 500 },
    )
  }
}
