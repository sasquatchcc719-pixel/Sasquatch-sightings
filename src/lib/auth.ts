import { createAdminClient, createClient } from '@/supabase/server'

export const STAFF_ROLES = ['owner', 'dispatcher', 'tech', 'marketing'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]
export type UserRole = 'admin' | 'partner' | 'client_manager' | StaffRole | null

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

export type StaffUserData = {
  id: string
  user_id: string | null
  display_name: string
  role: StaffRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export type ClientUserData = {
  can_sign_agreements?: boolean
  id: string
  user_id: string
  customer_id: string
  display_name: string
  email: string
  is_active: boolean
  created_at: string
  updated_at: string
}

function isStaffRole(role: string | null | undefined): role is StaffRole {
  return STAFF_ROLES.includes(role as StaffRole)
}

export function isOperationalRole(role: UserRole): role is 'admin' | StaffRole {
  return role === 'admin' || isStaffRole(role)
}

export function hasRoleAccess(
  currentRole: UserRole,
  allowedRoles: UserRole[],
): boolean {
  if (!currentRole) return false
  if (currentRole === 'admin') return true
  return allowedRoles.includes(currentRole)
}

/**
 * Get the current user and their role
 * Returns null if not authenticated
 */
export async function getUserWithRole(): Promise<{
  user: { id: string; email: string } | null
  role: UserRole
  partner: PartnerData | null
  staff: StaffUserData | null
  client: ClientUserData | null
}> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { user: null, role: null, partner: null, staff: null, client: null }
  }

  // Use admin client for role lookup to avoid RLS timing issues right after login.
  // The user identity is still verified above via the session cookie.
  const admin = createAdminClient()

  const { data: staff, error: staffError } = await admin
    .from('staff_users')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (staffError && !staffError.message.toLowerCase().includes('staff_users')) {
    console.error('[auth] staff_users lookup failed:', staffError.message)
  }

  if (staff && isStaffRole(staff.role)) {
    return {
      user: { id: user.id, email: user.email || '' },
      role: staff.role,
      partner: null,
      staff: staff as StaffUserData,
      client: null,
    }
  }

  const { data: partner } = await admin
    .from('partners')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (partner) {
    return {
      user: { id: user.id, email: user.email || '' },
      role: partner.role as UserRole,
      partner: partner as PartnerData,
      staff: null,
      client: null,
    }
  }

  const { data: client } = await admin
    .from('ops_client_users')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (client) {
    return {
      user: { id: user.id, email: user.email || '' },
      role: 'client_manager',
      partner: null,
      staff: null,
      client: client as ClientUserData,
    }
  }

  return {
    user: { id: user.id, email: user.email || '' },
    role: null,
    partner: null,
    staff: null,
    client: null,
  }
}

/**
 * Require the current user to be an active client_manager.
 * Returns the user and their scoped client record (which carries customer_id).
 * Throws 'Not a client manager' otherwise — every client-portal API must call this
 * and scope all queries by the returned customer_id.
 */
export async function requireClientManager(): Promise<{
  user: { id: string; email: string }
  client: ClientUserData
}> {
  const { user, role, client } = await getUserWithRole()

  if (!user || role !== 'client_manager' || !client) {
    throw new Error('Not a client manager')
  }

  return { user, client }
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

export async function requireAnyRole(
  allowedRoles: Array<'admin' | StaffRole>,
): Promise<{
  id: string
  email: string
  role: 'admin' | StaffRole
  staff: StaffUserData | null
}> {
  const { user, role, staff } = await getUserWithRole()

  if (!user || !isOperationalRole(role) || !hasRoleAccess(role, allowedRoles)) {
    throw new Error('Not authorized')
  }

  return {
    id: user.id,
    email: user.email,
    role,
    staff,
  }
}
