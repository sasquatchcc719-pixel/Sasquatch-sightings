import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  emailReceiptToQuickbooks,
  getQuickbooksReceiptEmail,
  setQuickbooksReceiptEmail,
} from '@/lib/ops/tech-receipts'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Save (or clear) the QuickBooks receipt-capture inbox address. */
export async function PUT(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const body = (await request.json()) as { email?: string }
    const email = (body.email ?? '').trim()

    if (email && !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: 'That does not look like a valid email address.' },
        { status: 400 },
      )
    }

    await setQuickbooksReceiptEmail(supabase, email)
    return NextResponse.json({ ok: true, email: email || null })
  } catch (error) {
    console.error('[admin/receipts][PUT]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: status === 401 ? 'Unauthorized' : 'Failed to save setting' },
      { status },
    )
  }
}

/** Send a test receipt to the configured QuickBooks inbox. */
export async function POST() {
  try {
    const access = await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const qbEmail = await getQuickbooksReceiptEmail(supabase)

    if (!qbEmail) {
      return NextResponse.json(
        { error: 'Set the QuickBooks receipt inbox address first.' },
        { status: 400 },
      )
    }

    const stamp = new Date().toLocaleString('en-US')
    const testImage = await sharp({
      create: {
        width: 900,
        height: 500,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="900" height="500" xmlns="http://www.w3.org/2000/svg">
              <rect width="900" height="500" fill="#ffffff"/>
              <text x="40" y="90" font-family="Arial" font-size="40" font-weight="bold" fill="#111">SASQUATCH — TEST RECEIPT</text>
              <text x="40" y="160" font-family="Arial" font-size="28" fill="#333">This is a connectivity test from the tech portal.</text>
              <text x="40" y="220" font-family="Arial" font-size="28" fill="#333">Vendor: TEST GAS STATION</text>
              <text x="40" y="270" font-family="Arial" font-size="28" fill="#333">Amount: $1.00</text>
              <text x="40" y="320" font-family="Arial" font-size="24" fill="#666">${stamp}</text>
            </svg>`,
          ),
          top: 0,
          left: 0,
        },
      ])
      .jpeg({ quality: 85 })
      .toBuffer()

    const result = await emailReceiptToQuickbooks({
      qbEmail,
      imageBuffer: testImage,
      filename: `test-receipt-${Date.now()}.jpg`,
      submittedByName: access.staff?.display_name ?? 'Admin test',
      category: 'gas',
      amount: 1,
      note: 'Test receipt — safe to delete in QuickBooks.',
    })

    await supabase.from('ops_email_log').insert({
      template_key: 'tech_gas_receipt_test',
      to_email: qbEmail,
      subject: 'Gas receipt $1.00 — test',
      resend_id: result.resendId ?? null,
      status: result.ok ? 'sent' : 'failed',
      error_message: result.error ?? null,
      body_text: 'Test receipt forwarding',
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? 'Send failed' },
        { status: 502 },
      )
    }
    return NextResponse.json({
      ok: true,
      to: qbEmail,
      resendId: result.resendId,
    })
  } catch (error) {
    console.error('[admin/receipts][POST]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: status === 401 ? 'Unauthorized' : 'Failed to send test' },
      { status },
    )
  }
}
