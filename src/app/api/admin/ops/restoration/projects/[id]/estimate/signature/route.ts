import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { requireAnyRole } from '@/lib/auth'

/**
 * Capture the customer's signature on the estimate, in person.
 *
 * Same storage and shape as the invoice signature so both look and behave
 * alike. Signing freezes the estimate — from that point revisions belong on the
 * work side, and the signed figure stays as the record of what was agreed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['owner', 'admin', 'dispatcher', 'tech'])
    const supabase = createAdminClient()
    const { signatureData, customerName } = await request.json()

    if (!signatureData || !customerName) {
      return NextResponse.json(
        { error: 'Missing signature data or customer name' },
        { status: 400 },
      )
    }

    const { id: projectId } = await params

    const { data: project } = await supabase
      .from('restoration_projects')
      .select('id, estimate_signed_at')
      .eq('id', projectId)
      .maybeSingle()
    if (!project) return NextResponse.json({ error: 'project_not_found' }, { status: 404 })
    if (project.estimate_signed_at) {
      return NextResponse.json({ error: 'estimate_already_signed' }, { status: 409 })
    }

    const base64Data = String(signatureData).replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    const fileName = `signatures/estimate_${projectId}_${Date.now()}.png`

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('job-images')
      .upload(fileName, buffer, { contentType: 'image/png', cacheControl: '3600' })

    if (uploadError) {
      console.error('[restoration/estimate/signature] upload:', uploadError)
      return NextResponse.json({ error: 'Failed to upload signature' }, { status: 500 })
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from('job-images').getPublicUrl(uploadData.path)

    const { error } = await supabase
      .from('restoration_projects')
      .update({
        estimate_signature_url: publicUrl,
        estimate_signed_at: new Date().toISOString(),
        estimate_signed_name: String(customerName),
      })
      .eq('id', projectId)

    if (error) throw error
    return NextResponse.json({ ok: true, signature_url: publicUrl })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to save signature'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}

/** Undo a signature that was captured by mistake, which unfreezes the estimate. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['owner', 'admin'])
    const { id } = await params
    const supabase = createAdminClient()

    const { error } = await supabase
      .from('restoration_projects')
      .update({
        estimate_signature_url: null,
        estimate_signed_at: null,
        estimate_signed_name: null,
      })
      .eq('id', id)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to clear signature'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
