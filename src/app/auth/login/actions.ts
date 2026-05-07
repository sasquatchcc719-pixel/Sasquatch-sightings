'use server'

import { createClient } from '@/supabase/server'
import { redirect } from 'next/navigation'

export async function loginAction(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    return { error: 'Email and password are required' }
  }

  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: error.message }
  }

  // Session cookies are now set server-side. Determine destination.
  const { data: staffUser } = await supabase
    .from('staff_users')
    .select('role')
    .eq('user_id', (await supabase.auth.getUser()).data.user!.id)
    .eq('is_active', true)
    .maybeSingle()

  if (staffUser?.role === 'tech') {
    redirect('/tech')
  }

  if (staffUser?.role) {
    redirect('/admin/operations')
  }

  const { data: partner } = await supabase
    .from('partners')
    .select('role')
    .eq('user_id', (await supabase.auth.getUser()).data.user!.id)
    .maybeSingle()

  if (partner?.role === 'partner') {
    redirect('/partners')
  }

  redirect('/admin')
}
