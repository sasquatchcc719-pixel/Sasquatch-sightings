import { createClient } from '@/supabase/server'

export type UserRole = 'admin' | 'partner' | null

export type PartnerData = {
  id: string
  user_id: string
  name: string
  email: string
  phone: string
  company_name: string
  company_website: string | null
  home_address: string
  backlink_opted_in: boolean
  backlink_verified: boolean
  credit_balance: number
  role: 'partner' | 'admin'
  created_at: string
}

/**
 * Get the current user and their role
 * Returns null if not authenticated
 */
export async function getUserWithRole(): Promise<{
  user: { id: string; email: string } | null
  role: UserRole
  partner: PartnerData | null
}> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { user: null, role: null, partner: null }
  }

  // Check if user has a partner record
  const { data: partner } = await supabase
    .from('partners')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (partner) {
    return {
      user: { id: user.id, email: user.email || '' },
      role: partner.role as UserRole,
      partner: partner as PartnerData,
    }
  }

  // No partner record - check if this is an existing admin user
  // For now, users without partner records but with auth are considered admins
  // (backward compatibility with existing admin users)
  return {
    user: { id: user.id, email: user.email || '' },
    role: 'admin',
    partner: null,
  }
}

/**
 * Check if user is authenticated
 */
export async function requireAuth(): Promise<{ id: string; email: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Not authenticated')
  }

  return { id: user.id, email: user.email || '' }
}

/**
 * Check if user is a partner
 */
export async function requirePartner(): Promise<PartnerData> {
  const { role, partner } = await getUserWithRole()

  if (role !== 'partner' || !partner) {
    throw new Error('Not a partner')
  }

  return partner
}

/**
 * Check if user is an admin
 */
export async function requireAdmin(): Promise<{ id: string; email: string }> {
  const { user, role } = await getUserWithRole()

  if (!user || role !== 'admin') {
    throw new Error('Not an admin')
  }

  return user
}
