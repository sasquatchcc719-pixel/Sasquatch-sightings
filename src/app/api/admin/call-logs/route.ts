import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { requireAnyRole } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])

    const days = Math.min(
      parseInt(request.nextUrl.searchParams.get('days') || '30', 10),
      90,
    )
    const since = new Date(Date.now() - days * 86400000).toISOString()

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('call_logs')
      .select(
        'id, call_sid, caller_phone, outcome, duration_seconds, recording_url, transcription, created_at',
      )
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) throw error

    const calls = data ?? []

    // Cross-reference caller phones against ops_customers
    const phones = [
      ...new Set(calls.map((c) => c.caller_phone).filter(Boolean)),
    ]
    let customerMap: Record<string, string> = {}
    if (phones.length > 0) {
      const { data: customers } = await supabase
        .from('ops_customers')
        .select('phone, full_name')
        .in('phone', phones as string[])
      if (customers) {
        customerMap = Object.fromEntries(
          customers.map((c) => [c.phone, c.full_name]),
        )
      }
    }

    const callsWithNames = calls.map((c) => ({
      ...c,
      customer_name: c.caller_phone
        ? (customerMap[c.caller_phone] ?? null)
        : null,
    }))

    const summary = {
      total: calls.length,
      answered: calls.filter((r) => r.outcome === 'answered').length,
      voicemail: calls.filter((r) => r.outcome === 'voicemail').length,
      missed: calls.filter((r) => r.outcome === 'no-answer').length,
      blacklisted: calls.filter((r) => r.outcome === 'blacklisted').length,
    }

    return NextResponse.json({ calls: callsWithNames, summary })
  } catch (err) {
    console.error('[admin/call-logs][GET]', err)
    return NextResponse.json(
      { error: 'Failed to load call logs' },
      { status: 500 },
    )
  }
}
