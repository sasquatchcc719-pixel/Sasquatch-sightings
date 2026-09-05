import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadCommercialData } from '@/lib/ops/commercial-server'
import { commercialProfileSchema } from '@/lib/ops/commercial'
type Context = { params: Promise<{ id: string }> }
export async function GET(_request: NextRequest, { params }: Context) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const db = createAdminClient()
    const [commercial, estimates, users, plans] = await Promise.all([
      loadCommercialData(db, id, true),
      db
        .from('ops_appointments')
        .select('id,appointment_date,quoted_total,estimate_status')
        .eq('customer_id', id)
        .eq('kind', 'estimate')
        .in('estimate_status', ['accepted', 'converted'])
        .order('appointment_date', { ascending: false }),
      db
        .from('ops_client_users')
        .select('id,display_name,email,is_active,can_sign_agreements')
        .eq('customer_id', id),
      db
        .from('ops_recurring_templates')
        .select(
          'id,label,is_active,commercial_agreement_id,start_time,assigned_staff_user_id,staff_users(display_name)',
        )
        .eq('customer_id', id)
        .not('commercial_agreement_id', 'is', null)
        .order('created_at', { ascending: false }),
    ])
    if (estimates.error || users.error || plans.error)
      throw estimates.error || users.error || plans.error
    return NextResponse.json({
      ...commercial,
      estimates: estimates.data,
      users: users.data,
      plans: plans.data,
    })
  } catch (e) {
    return NextResponse.json(
      { error: 'Unable to load commercial account' },
      {
        status:
          e instanceof Error && e.message === 'Not authorized' ? 403 : 500,
      },
    )
  }
}
export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const user = await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const profile = commercialProfileSchema.parse(await request.json())
    const { error } = await createAdminClient()
      .from('ops_commercial_profiles')
      .upsert({
        ...profile,
        customer_id: id,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: 'Check the profile fields and try again' },
      {
        status:
          e instanceof Error && e.message === 'Not authorized' ? 403 : 400,
      },
    )
  }
}
