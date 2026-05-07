'use server'

import { createClient, createAdminClient } from '@/supabase/server'
import { redirect } from 'next/navigation'

export async function loginAction(
  _prevState: { error: string },
  formData: FormData,
): Promise<{ error: string }> {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    return { error: 'Email and password are required' }
  }

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: error.message }
  }

  const userId = data.user.id

  // Use admin client for role lookup (RLS not yet active for freshly-signed-in session)
  const admin = createAdminClient()

  const { data: staffUser } = await admin
    .from('staff_users')
    .select('role')
    .eq('user_id', userId)
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
    .eq('user_id', userId)
    .maybeSingle()

  if (partner?.role === 'partner') {
    redirect('/partners')
  }

  redirect('/admin')
}
