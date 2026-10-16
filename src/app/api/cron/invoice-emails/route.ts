import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { retryInvoiceEmails } from '@/lib/ops/invoice-email-delivery'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json({
      statuses: await retryInvoiceEmails(createAdminClient()),
    })
  } catch (error) {
    console.error('[cron/invoice-emails]', error)
    return NextResponse.json(
      { error: 'Invoice email retry failed' },
      { status: 500 },
    )
  }
}
