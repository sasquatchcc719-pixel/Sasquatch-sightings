import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * Enter or update Google LSA charges by hand.
 *
 * Google exposes no dollar amount through any API — local_services_lead
 * .lead_charged is a bare boolean — so the only sources of truth are the
 * "Billing activity" screen and its CSV export. This endpoint is the button
 * that keeps the dashboard current without depending on Google approving API
 * access or on a scraper surviving a session expiry.
 *
 * Accepts either one row or pasted rows, upserted on (charge_date, description)
 * so re-entering an overlapping range corrects rather than double-counts.
 */

type IncomingRow = {
  date?: string
  leads?: number | string
  cost?: number | string
  credits?: number | string
}

const ACCOUNT_CID = '344-177-2449'
const DESCRIPTION = 'Home Services Ads activity'

function parseRow(row: IncomingRow) {
  const date = String(row.date || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null

  const leads = Number(row.leads ?? 0)
  const cost = Number(row.cost ?? 0)
  const credits = Number(row.credits ?? 0)
  if (!Number.isFinite(leads) || !Number.isFinite(cost)) return null
  if (leads < 0 || cost < 0 || cost > 100_000) return null

  return {
    charge_date: date,
    description: DESCRIPTION,
    leads: Math.round(leads),
    cost: Math.round(cost * 100) / 100,
    credits: Number.isFinite(credits) ? Math.round(credits * 100) / 100 : 0,
    account_cid: ACCOUNT_CID,
    source: 'manual_entry',
    synced_at: new Date().toISOString(),
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))

    const incoming: IncomingRow[] = Array.isArray(body.rows)
      ? body.rows
      : [body]

    const parsed = incoming.map(parseRow).filter(Boolean) as ReturnType<
      typeof parseRow
    >[]

    if (!parsed.length) {
      return NextResponse.json(
        { error: 'Need a date (YYYY-MM-DD) and a cost.' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('lsa_charges')
      .upsert(parsed, { onConflict: 'charge_date,description' })
      .select('charge_date, leads, cost, credits')

    if (error) throw error

    return NextResponse.json({ saved: data?.length || 0, rows: data })
  } catch (error) {
    console.error('[admin/marketing/lsa/charges][POST]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json({ error: 'Failed to save charges' }, { status })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date') || ''

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }

    const { error } = await supabase
      .from('lsa_charges')
      .delete()
      .eq('charge_date', date)
      .eq('description', DESCRIPTION)

    if (error) throw error
    return NextResponse.json({ deleted: date })
  } catch (error) {
    console.error('[admin/marketing/lsa/charges][DELETE]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json({ error: 'Failed to delete' }, { status })
  }
}
