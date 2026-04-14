import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { generateAllRecurring } from '@/lib/ops/recurring'

/**
 * Daily cron: top-up recurring appointments to maintain the 12-month horizon.
 * Vercel cron triggers this once per day. The generation is idempotent —
 * existing appointments for a template+date pair are skipped.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const results = await generateAllRecurring(supabase)

    const summary = results.map((r) => ({
      template: r.label,
      created: r.created,
      skipped: r.skipped,
      errors: r.errors.length,
    }))

    console.log('[cron/recurring-jobs] Summary:', JSON.stringify(summary))

    return NextResponse.json({ ok: true, summary })
  } catch (error) {
    console.error('[cron/recurring-jobs] Error:', error)
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
