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
  const { data: partner, error: partnerError } = await supabase
    .from('partners')
    .select('*')
    .eq('user_id', user.id)
    .single()

  console.log('[Auth] User ID:', user.id)
  console.log('[Auth] User email:', user.email)
  console.log('[Auth] Partner query result:', JSON.stringify(partner))
  console.log('[Auth] Partner query error:', partnerError?.message)

  if (partner) {
    // Explicitly check the role value
    const partnerRole = partner.role
    console.log('[Auth] Found partner record. Role value:', partnerRole, 'Type:', typeof partnerRole)
    
    // Determine role - if role is 'partner', return 'partner', otherwise 'admin'
    const finalRole: UserRole = partnerRole === 'partner' ? 'partner' : 'admin'
    console.log('[Auth] Final role determination:', finalRole)
    
    return {
      user: { id: user.id, email: user.email || '' },
      role: finalRole,
      partner: partner as PartnerData,
    }
  }

  // No partner record = existing admin user (backward compatibility)
  console.log('[Auth] No partner record found, user is legacy admin')
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
