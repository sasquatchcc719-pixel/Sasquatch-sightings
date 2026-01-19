/**
 * Upload API Route Handler
 * Handles job creation: image upload, geocoding, Sharp optimization, and immediate publishing
 * Per .cursorrules data flow:
 * Photo → EXIF extraction (client) → compression (client) → upload (here) →
 * geocode (Nominatim) → Sharp optimization → Supabase storage → published job record
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'
import { reverseGeocode } from '@/lib/geocode'
import { generateJobSlug } from '@/lib/slug'
import { generateSEOFilename } from '@/lib/seo-filename'
import sharp from 'sharp'

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse form data
    const formData = await request.formData()
    const imageFile = formData.get('image') as File
    const serviceId = formData.get('serviceId') as string
    const description = formData.get('description') as string | null
    const gpsLat = formData.get('gpsLat') as string | null
    const gpsLng = formData.get('gpsLng') as string | null

    // Validate required fields
    if (!imageFile || !serviceId || !description) {
      return NextResponse.json(
        { error: 'Image, service type, and description are required' },
        { status: 400 }
      )
    }

    if (!gpsLat || !gpsLng) {
      return NextResponse.json(
        { error: 'GPS coordinates are required' },
        { status: 400 }
      )
    }

    const lat = parseFloat(gpsLat)
    const lng = parseFloat(gpsLng)

    // Get service details for slug generation
    const { data: service } = await supabase
      .from('services')
      .select('name, slug')
      .eq('id', serviceId)
      .single()

    if (!service) {
      return NextResponse.json(
        { error: 'Invalid service type' },
        { status: 400 }
      )
    }

    // Reverse geocode to get city, state, and neighborhood
    const { city, state, neighborhood } = await reverseGeocode(lat, lng)

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
    // Format: {service-slug}-in-{city}-{state}-{timestamp}.jpg
    // Example: pet-urine-removal-in-monument-co-1705634892.jpg
    const filename = generateSEOFilename(
      service.slug,
      city,
      state,
      imageFile.name
    )

    // Upload optimized image to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('job-images')
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
    } = supabase.storage.from('job-images').getPublicUrl(filename)

    // Generate fuzzed GPS coordinates (offset by ~100-500 meters for privacy)
    const fuzzOffset = 0.002 // approximately 200 meters
    const fuzzLat = lat + (Math.random() - 0.5) * fuzzOffset
    const fuzzLng = lng + (Math.random() - 0.5) * fuzzOffset

    // Generate job slug
    const slug = generateJobSlug(service.name, city)

    // Insert job record into database (published immediately)
    const { data: job, error: insertError } = await supabase
      .from('jobs')
      .insert({
        service_id: serviceId,
        image_url: publicUrl,
        image_filename: filename,
        gps_lat: lat,
        gps_lng: lng,
        gps_fuzzy_lat: fuzzLat,
        gps_fuzzy_lng: fuzzLng,
        city,
        neighborhood,
        raw_voice_input: description,
        ai_description: description,
        slug,
        status: 'published',
        published_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (insertError) {
      console.error('Database insert error:', insertError)
      return NextResponse.json(
        { error: 'Failed to create job record' },
        { status: 500 }
      )
    }

    // Return success with job details
    return NextResponse.json(
      {
        success: true,
        job: {
          id: job.id,
          slug: job.slug,
          city: job.city,
          neighborhood: job.neighborhood,
          imageUrl: job.image_url,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Upload API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
