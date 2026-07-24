/**
 * Upload a PDF copy of a chemical's Safety Data Sheet. This is Charles's own
 * offline copy of the manufacturer's real SDS — stored so the field "Open SDS"
 * button works even if the manufacturer's link rots. Reuses the job-images
 * bucket under a chemical-sds/ prefix.
 *
 * An SDS is a legal manufacturer document; we only ever store the real PDF,
 * never a generated one.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserWithRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, role } = await getUserWithRole()
  if (!user || (role !== 'admin' && role !== 'owner')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'A PDF is required' }, { status: 400 })
  }
  if (file.type !== 'application/pdf') {
    return NextResponse.json(
      { error: 'The SDS must be a PDF' },
      { status: 400 },
    )
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: 'SDS PDF must be smaller than 15 MB' },
      { status: 400 },
    )
  }

  const supabase = createAdminClient()
  const storagePath = `chemical-sds/${id}.pdf`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('job-images')
    .upload(storagePath, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    })
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  // Cache-bust so a re-uploaded sheet at the same path serves the new file.
  const {
    data: { publicUrl },
  } = supabase.storage.from('job-images').getPublicUrl(uploadData.path)
  const bustedUrl = `${publicUrl}?v=${Date.now()}`

  const { data: product, error: updateError } = await supabase
    .from('chemical_products')
    .update({ sds_file_url: bustedUrl, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ product, url: bustedUrl })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, role } = await getUserWithRole()
  if (!user || (role !== 'admin' && role !== 'owner')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params

  const supabase = createAdminClient()
  await supabase.storage.from('job-images').remove([`chemical-sds/${id}.pdf`])
  const { data: product, error } = await supabase
    .from('chemical_products')
    .update({ sds_file_url: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ product })
}
