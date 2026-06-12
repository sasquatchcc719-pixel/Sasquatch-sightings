import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { assertTechAppointmentAccess } from '@/lib/ops/tech-job-access'

type Params = { params: Promise<{ id: string }> }

// Build a label badge SVG (e.g. "BEFORE" / "AFTER" / "GENERAL")
function buildLabelBadgeSvg(label: string): Buffer {
  const text = label.toUpperCase()
  const color =
    label === 'before' ? '#2563eb' : label === 'after' ? '#16a34a' : '#6b7280'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="52">
    <rect width="160" height="52" rx="8" fill="${color}" opacity="0.92"/>
    <text x="80" y="35" font-family="Arial, Helvetica, sans-serif" font-size="24"
      font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="auto">${text}</text>
  </svg>`
  return Buffer.from(svg)
}

// Load and scale the logo SVG for watermarking
async function buildLogoOverlay(targetWidth: number): Promise<Buffer> {
  const logoPath = path.join(process.cwd(), 'public', 'sasquatch-logo.svg')
  const logoExists = fs.existsSync(logoPath)
  if (!logoExists) throw new Error('Logo file not found')

  // Resize logo to ~25% of image width, keeping aspect ratio (logo is 2723:1155)
  const logoW = Math.round(targetWidth * 0.28)
  const logoH = Math.round(logoW * (1155 / 2723))

  return await sharp(logoPath).resize(logoW, logoH).png().toBuffer()
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
    ])
    const supabase = createAdminClient()
    const { id } = await params
    await assertTechAppointmentAccess(supabase, access, id)

    const { data, error } = await supabase
      .from('ops_job_photos')
      .select('*')
      .eq('appointment_id', id)
      .order('created_at', { ascending: true })

    if (error) throw error
    return NextResponse.json({ photos: data ?? [] })
  } catch (err) {
    console.error('[ops/photos][GET]', err)
    return NextResponse.json(
      { error: 'Failed to load photos' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
    ])
    const supabase = createAdminClient()
    const { id: appointmentId } = await params
    await assertTechAppointmentAccess(supabase, access, appointmentId)

    const formData = await request.formData()
    const imageFile = formData.get('image') as File | null
    const label = (formData.get('label') as string | null) ?? 'general'
    const watermark = formData.get('watermark') === 'true'

    if (!imageFile) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 })
    }

    const validLabels = ['before', 'after', 'general']
    const safeLabel = validLabels.includes(label) ? label : 'general'

    // Convert to buffer for Sharp
    const arrayBuffer = await imageFile.arrayBuffer()
    const rawBuffer = Buffer.from(arrayBuffer)

    // Get image dimensions for compositing
    const meta = await sharp(rawBuffer).metadata()
    const imgWidth = meta.width ?? 1920
    const imgHeight = meta.height ?? 1920

    // Base Sharp pipeline — resize + JPEG optimization
    let pipeline = sharp(rawBuffer).resize(1920, 1920, {
      fit: 'inside',
      withoutEnlargement: true,
    })

    const composites: sharp.OverlayOptions[] = []

    // Label badge — top-left corner
    if (safeLabel !== 'general') {
      const badgeSvg = buildLabelBadgeSvg(safeLabel)
      composites.push({
        input: badgeSvg,
        top: 24,
        left: 24,
      })
    }

    // Logo watermark — bottom-right corner
    if (watermark) {
      try {
        const effectiveWidth = Math.min(imgWidth, 1920)
        const logoBuffer = await buildLogoOverlay(effectiveWidth)
        const logoMeta = await sharp(logoBuffer).metadata()
        const logoW = logoMeta.width ?? 300
        const logoH = logoMeta.height ?? 128

        // Position: 24px from right and bottom edges
        const effectiveHeight = Math.min(imgHeight, 1920)
        composites.push({
          input: logoBuffer,
          top: effectiveHeight - logoH - 24,
          left: effectiveWidth - logoW - 24,
        })
      } catch (logoErr) {
        console.error('[photos] Logo watermark failed, skipping:', logoErr)
      }
    }

    if (composites.length > 0) {
      pipeline = pipeline.composite(composites) as typeof pipeline
    }

    const optimizedBuffer = await pipeline.jpeg({ quality: 85 }).toBuffer()

    // Generate storage path
    const timestamp = Date.now()
    const labelPrefix = safeLabel !== 'general' ? `${safeLabel}-` : ''
    const storagePath = `job-photos/${appointmentId}/${labelPrefix}${timestamp}.jpg`

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
        label: safeLabel,
        watermarked: watermark,
      })
      .select()
      .single()

    if (insertError) throw insertError

    return NextResponse.json({ photo }, { status: 201 })
  } catch (err) {
    console.error('[ops/photos][POST]', err)
    return NextResponse.json(
      { error: 'Failed to upload photo' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
    ])
    const supabase = createAdminClient()
    const { id: appointmentId } = await params
    await assertTechAppointmentAccess(supabase, access, appointmentId)
    const { searchParams } = new URL(request.url)
    const photoId = searchParams.get('photoId')

    if (!photoId) {
      return NextResponse.json({ error: 'photoId required' }, { status: 400 })
    }

    // Fetch to get storage path
    const { data: photo, error: fetchError } = await supabase
      .from('ops_job_photos')
      .select('storage_path')
      .eq('id', photoId)
      .eq('appointment_id', appointmentId)
      .single()

    if (fetchError || !photo) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    }

    // Delete from storage
    await supabase.storage.from('job-images').remove([photo.storage_path])

    // Delete from DB
    const { error: deleteError } = await supabase
      .from('ops_job_photos')
      .delete()
      .eq('id', photoId)

    if (deleteError) throw deleteError

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[ops/photos][DELETE]', err)
    return NextResponse.json(
      { error: 'Failed to delete photo' },
      { status: 500 },
    )
  }
}
