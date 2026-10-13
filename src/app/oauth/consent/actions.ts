'use server'

import { redirect } from 'next/navigation'
import { getUserWithRole } from '@/lib/auth'
import { createClient } from '@/supabase/server'

function authorizationId(formData: FormData): string {
  const value = formData.get('authorization_id')
  if (
    typeof value !== 'string' ||
    value.length < 10 ||
    value.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new Error('Invalid OAuth authorization request')
  }
  return value
}

export async function approveOAuth(formData: FormData) {
  const id = authorizationId(formData)
  const { user, role, staff } = await getUserWithRole()
  if (!user || role !== 'owner' || !staff?.is_active) {
    throw new Error('This account is not authorized for MCP access')
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.oauth.approveAuthorization(id, {
    skipBrowserRedirect: true,
  })
  if (error || !data?.redirect_url) {
    throw new Error(error?.message || 'OAuth approval failed')
  }
  redirect(data.redirect_url)
}

export async function denyOAuth(formData: FormData) {
  const id = authorizationId(formData)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Sign in before denying this request')

  const { data, error } = await supabase.auth.oauth.denyAuthorization(id, {
    skipBrowserRedirect: true,
  })
  if (error || !data?.redirect_url) {
    throw new Error(error?.message || 'OAuth denial failed')
  }
  redirect(data.redirect_url)
}
