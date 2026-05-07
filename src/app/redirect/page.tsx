import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/supabase/server'

export default async function RedirectPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Use admin client for role lookup to avoid RLS timing issues
  const admin = createAdminClient()

  const { data: staffUser } = await admin
    .from('staff_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (staffUser?.role === 'tech') {
    redirect('/tech')
  }

  if (staffUser?.role) {
    redirect('/admin/operations')
  }

  const { data: partner } = await admin
    .from('partners')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (partner?.role === 'partner') {
    redirect('/partners')
  }

  redirect('/admin')
}
