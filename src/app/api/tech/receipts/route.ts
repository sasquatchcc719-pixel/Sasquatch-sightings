import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  emailReceiptToQuickbooks,
  getQuickbooksReceiptEmail,
} from '@/lib/ops/tech-receipts'

const VALID_CATEGORIES = ['gas', 'supplies', 'other']

function parseAmount(raw: string | null): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const value = Number.parseFloat(cleaned)
  return Number.isFinite(value) && value >= 0 ? value : null
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const supabase = createAdminClient()
    // staff_user_id is an FK into staff_users; only set it for real staff rows.
    const staffUserId = access.staff?.id ?? null
    const submittedByName = access.staff?.display_name ?? 'Tech'

    const formData = await request.formData()
    const imageFile = formData.get('image') as File | null
    const amount = parseAmount(formData.get('amount') as string | null)
    const noteRaw = (formData.get('note') as string | null)?.trim() || null
    const note = noteRaw ? noteRaw.slice(0, 500) : null
    const categoryRaw = (formData.get('category') as string | null) ?? 'gas'
    const category = VALID_CATEGORIES.includes(categoryRaw)
      ? categoryRaw
      : 'gas'

    if (!imageFile) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 })
    }

    const rawBuffer = Buffer.from(await imageFile.arrayBuffer())
    const optimizedBuffer = await sharp(rawBuffer)
      .rotate() // honor EXIF orientation from phone cameras
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()

    const timestamp = Date.now()
    const storagePath = `receipts/${staffUserId ?? 'staff'}/${timestamp}.jpg`

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

    const qbEmail = await getQuickbooksReceiptEmail(supabase)

    const { data: receipt, error: insertError } = await supabase
      .from('ops_tech_receipts')
      .insert({
        staff_user_id: staffUserId,
        submitted_by_name: submittedByName,
        storage_path: storagePath,
        public_url: publicUrl,
        amount,
        note,
        category,
        status: qbEmail ? 'pending' : 'no_destination',
        qb_email: qbEmail,
      })
      .select()
      .single()
    if (insertError) throw insertError

    // Forward to QuickBooks if an inbox is configured. Capture always succeeds
    // even if forwarding fails — David's receipt is never lost.
    if (qbEmail) {
      const send = await emailReceiptToQuickbooks({
        qbEmail,
        imageBuffer: optimizedBuffer,
        filename: `receipt-${timestamp}.jpg`,
        submittedByName,
        category,
        amount,
        note,
      })

      await supabase
        .from('ops_tech_receipts')
        .update({
          status: send.ok ? 'sent' : 'failed',
          resend_id: send.resendId ?? null,
          error_message: send.error ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', receipt.id)

      await supabase.from('ops_email_log').insert({
        template_key: 'tech_gas_receipt',
        to_email: qbEmail,
        subject: `${category} receipt — ${submittedByName}`,
        resend_id: send.resendId ?? null,
        status: send.ok ? 'sent' : 'failed',
        error_message: send.error ?? null,
        body_text: note,
      })

      return NextResponse.json(
        {
          receipt: {
            ...receipt,
            status: send.ok ? 'sent' : 'failed',
            error_message: send.error ?? null,
          },
          forwarded: send.ok,
          error: send.ok ? undefined : send.error,
        },
        { status: 201 },
      )
    }

    return NextResponse.json(
      {
        receipt,
        forwarded: false,
        warning: 'No QuickBooks receipt inbox configured yet — receipt saved.',
      },
      { status: 201 },
    )
  } catch (error) {
    console.error('[tech/receipts][POST]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: status === 401 ? 'Unauthorized' : 'Failed to save receipt' },
      { status },
    )
  }
}

export async function GET() {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const supabase = createAdminClient()
    const staffUserId = access.staff?.id ?? null

    const { data: receipts, error } = await supabase
      .from('ops_tech_receipts')
      .select(
        'id, public_url, amount, note, category, status, error_message, created_at',
      )
      .eq('staff_user_id', staffUserId)
      .order('created_at', { ascending: false })
      .limit(25)
    if (error) throw error

    return NextResponse.json({ receipts: receipts ?? [] })
  } catch (error) {
    console.error('[tech/receipts][GET]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: status === 401 ? 'Unauthorized' : 'Failed to load receipts' },
      { status },
    )
  }
}
