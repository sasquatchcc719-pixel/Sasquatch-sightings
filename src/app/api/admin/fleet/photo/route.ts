/**
 * Fleet asset reference photo upload — "this is what Blue Van looks like",
 * so techs can visually confirm the right asset at check-in. Reuses the
 * job-images bucket under a fleet-assets/ prefix.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

function extensionForFile(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase()
  if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/webp') return 'webp'
  if (file.type === 'image/heic') return 'heic'
  if (file.type === 'image/heif') return 'heif'
  return 'jpg'
}

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await request.formData()
  const file = form.get('file')
  const assetId = String(form.get('assetId') ?? '')

  if (!assetId) {
    return NextResponse.json({ error: 'assetId is required' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Photo is required' }, { status: 400 })
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: 'Please upload a JPG, PNG, WebP, or HEIC image' },
      { status: 400 },
    )
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: 'Photo must be smaller than 5 MB' },
      { status: 400 },
    )
  }

  const supabase = createAdminClient()
  const ext = extensionForFile(file)
  const storagePath = `fleet-assets/${assetId}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('job-images')
    .upload(storagePath, buffer, {
      contentType: file.type || 'image/jpeg',
      upsert: true,
    })
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from('job-images').getPublicUrl(uploadData.path)

  const { error: updateError } = await supabase
    .from('fleet_assets')
    .update({ image_url: publicUrl })
    .eq('id', assetId)
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ url: publicUrl })
}
