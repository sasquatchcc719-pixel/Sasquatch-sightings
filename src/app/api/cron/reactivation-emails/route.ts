import { NextRequest, NextResponse } from 'next/server'
import { processReactivationEmails } from '@/lib/ops/reactivation-campaign'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await processReactivationEmails()
    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error('[cron/reactivation-emails] Error:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to process reactivation emails',
      },
      { status: 500 },
    )
  }
}
