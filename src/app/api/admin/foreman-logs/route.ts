/**
 * Foreman diagnostic log listing — what the field AI told the techs.
 */

import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()
  const [{ data: logs, error }, { data: staff }] = await Promise.all([
    supabase
      .from('ai_diagnostic_logs')
      .select('id, user_id, transcript, recommendation, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('staff_users').select('user_id, display_name'),
  ])
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const nameByUser = new Map(
    (staff ?? []).map((s) => [s.user_id, s.display_name]),
  )
  return NextResponse.json({
    logs: (logs ?? []).map((l) => ({
      id: l.id,
      user_name: nameByUser.get(l.user_id) ?? 'Unknown',
      transcript: l.transcript,
      reply: (l.recommendation as { reply?: string } | null)?.reply ?? null,
      created_at: l.created_at,
    })),
  })
}
