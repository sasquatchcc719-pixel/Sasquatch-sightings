import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { getAssignedTechAppointments } from '@/lib/tech/appointments'
import { createAdminClient } from '@/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const date =
      searchParams.get('date') || new Date().toISOString().split('T')[0]
    const staffUserId = access.staff?.id ?? access.id
    const appointments = await getAssignedTechAppointments(
      supabase,
      staffUserId,
      date,
    )

    return NextResponse.json({ date, appointments })
  } catch (error) {
    console.error('[tech/appointments][GET]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: status === 401 ? 'Unauthorized' : 'Failed to load jobs' },
      { status },
    )
  }
}
