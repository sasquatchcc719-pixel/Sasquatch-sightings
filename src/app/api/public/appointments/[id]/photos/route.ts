import { randomUUID } from 'crypto'
import sharp from 'sharp'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import {
  CustomerPhotoUploadTokenError,
  verifyCustomerPhotoUploadToken,
} from '@/lib/ops/customer-photo-upload-token'

type Params = { params: Promise<{ id: string }> }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-booking-secret',
}

const MAX_CUSTOMER_PHOTOS = 5
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const VALID_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

function cleanOriginalFilename(value: string): string | null {
  const cleaned = value.replace(/[\\/]/g, '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  return cleaned.slice(0, 160)
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const secret = request.headers.get('x-booking-secret')
    if (!secret || secret !== process.env.BOOKING_API_SECRET) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: CORS },
      )
    }

    const { id: appointmentId } = await params
    const formData = await request.formData()
    const token = String(formData.get('upload_token') || '').trim()
    const invoiceId = String(formData.get('invoice_id') || '').trim()
    const imageFile = formData.get('image') as File | null

    if (!token || !invoiceId || !imageFile) {
      return NextResponse.json(
        { error: 'Photo, invoice, and upload token are required.' },
        { status: 400, headers: CORS },
      )
    }

    const verified = verifyCustomerPhotoUploadToken(token)
    if (
      verified.appointmentId !== appointmentId ||
      verified.invoiceId !== invoiceId
    ) {
      return NextResponse.json(
        { error: 'Photo upload token does not match this booking.' },
        { status: 403, headers: CORS },
      )
    }

    if (imageFile.size <= 0) {
      return NextResponse.json(
        { error: 'Please choose a photo to upload.' },
        { status: 400, headers: CORS },
      )
    }

    if (imageFile.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: 'Photo must be 10 MB or smaller.' },
        { status: 413, headers: CORS },
      )
    }

    if (imageFile.type && !VALID_IMAGE_TYPES.has(imageFile.type)) {
      return NextResponse.json(
        { error: 'Please upload a JPG, PNG, WebP, or HEIC image.' },
        { status: 415, headers: CORS },
      )
    }

    const supabase = createAdminClient()
    const { data: invoice, error: invoiceError } = await supabase
      .from('ops_invoices')
      .select('id, appointment_id')
      .eq('id', invoiceId)
      .eq('appointment_id', appointmentId)
      .maybeSingle()

    if (invoiceError) throw invoiceError
    if (!invoice) {
      return NextResponse.json(
        { error: 'Booking invoice was not found.' },
        { status: 404, headers: CORS },
      )
    }

    const { count, error: countError } = await supabase
      .from('ops_job_photos')
      .select('id', { count: 'exact', head: true })
      .eq('appointment_id', appointmentId)
      .eq('source', 'customer')

    if (countError) throw countError
    if ((count ?? 0) >= MAX_CUSTOMER_PHOTOS) {
      return NextResponse.json(
        { error: `You can attach up to ${MAX_CUSTOMER_PHOTOS} photos.` },
        { status: 409, headers: CORS },
      )
    }

    const rawBuffer = Buffer.from(await imageFile.arrayBuffer())
    let optimizedBuffer: Buffer
    try {
      optimizedBuffer = await sharp(rawBuffer)
        .rotate()
        .resize(1920, 1920, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 82 })
        .toBuffer()
    } catch {
      return NextResponse.json(
        { error: 'That file could not be read as an image.' },
        { status: 400, headers: CORS },
      )
    }

    const storagePath = `job-photos/${appointmentId}/customer-${Date.now()}-${randomUUID()}.jpg`

    const { error: uploadError } = await supabase.storage
      .from('job-images')
      .upload(storagePath, optimizedBuffer, {
        contentType: 'image/jpeg',
        upsert: false,
      })

    if (uploadError) throw uploadError

    const {
      data: { publicUrl },
    } = supabase.storage.from('job-images').getPublicUrl(storagePath)

    const { data: photo, error: insertError } = await supabase
      .from('ops_job_photos')
      .insert({
        appointment_id: appointmentId,
        storage_path: storagePath,
        public_url: publicUrl,
        label: 'general',
        watermarked: false,
        source: 'customer',
        uploaded_by_label: 'Customer',
        original_filename: cleanOriginalFilename(imageFile.name),
      })
      .select()
      .single()

    if (insertError) throw insertError

    return NextResponse.json({ photo }, { status: 201, headers: CORS })
  } catch (error) {
    if (error instanceof CustomerPhotoUploadTokenError) {
      return NextResponse.json(
        { error: error.message },
        {
          status: error.code === 'expired' ? 410 : 403,
          headers: CORS,
        },
      )
    }

    console.error('[public/appointments/:id/photos][POST]', error)
    return NextResponse.json(
      { error: 'Failed to upload photo.' },
      { status: 500, headers: CORS },
    )
  }
}
