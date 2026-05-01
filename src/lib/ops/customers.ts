import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeOpsPhone, opsPhoneLookupVariants } from '@/lib/ops/phone'

type ResolveOpsCustomerInput = {
  supabase: SupabaseClient
  firstName: string
  lastName: string
  email: string
  phone: string
  notes?: string | null
}

export type ResolvedOpsCustomer = {
  id: string
  quickbooks_customer_id: string | null
}

type OpsCustomerRow = {
  id: string
  full_name: string | null
  business_name: string | null
  email: string | null
  phone: string | null
  quickbooks_customer_id: string | null
}

function normalizeEmail(email: string): string {
  return String(email || '')
    .trim()
    .toLowerCase()
}

/**
 * Canonical find-or-create for ops customers.
 *
 * Public/AI booking used to match by email only, which could create duplicate
 * customers whenever the same phone number was submitted with a typo/new email.
 * Phone is the strongest customer-facing identity we have, so prefer phone
 * variants first, then fall back to email.
 */
export async function resolveOpsCustomer({
  supabase,
  firstName,
  lastName,
  email,
  phone,
  notes,
}: ResolveOpsCustomerInput): Promise<ResolvedOpsCustomer> {
  const cleanFirstName = firstName.trim()
  const cleanLastName = lastName.trim()
  const cleanEmail = normalizeEmail(email)
  const cleanPhone = normalizeOpsPhone(phone)
  const fullName = `${cleanFirstName} ${cleanLastName}`.trim()
  const now = new Date().toISOString()

  const phoneVariants = opsPhoneLookupVariants(cleanPhone)

  let phoneMatch: OpsCustomerRow | null = null
  if (phoneVariants.length > 0) {
    const { data, error } = await supabase
      .from('ops_customers')
      .select(
        'id, full_name, business_name, email, phone, quickbooks_customer_id',
      )
      .in('phone', phoneVariants)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    phoneMatch = data
  }

  let emailMatch: OpsCustomerRow | null = null
  if (cleanEmail) {
    const { data, error } = await supabase
      .from('ops_customers')
      .select(
        'id, full_name, business_name, email, phone, quickbooks_customer_id',
      )
      .ilike('email', cleanEmail)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    emailMatch = data
  }

  const phoneMatchLooksLikeDifferentBusiness =
    !!phoneMatch?.business_name &&
    !!fullName &&
    ![phoneMatch.full_name, phoneMatch.business_name]
      .filter(Boolean)
      .some((name) => name!.trim().toLowerCase() === fullName.toLowerCase()) &&
    (!phoneMatch.email ||
      !cleanEmail ||
      normalizeEmail(phoneMatch.email) !== cleanEmail)

  const existingCustomer = phoneMatchLooksLikeDifferentBusiness
    ? emailMatch
    : phoneMatch || emailMatch

  if (existingCustomer) {
    if (phoneMatch && emailMatch && phoneMatch.id !== emailMatch.id) {
      console.warn('[resolveOpsCustomer] possible duplicate identity', {
        phoneCustomerId: phoneMatch.id,
        emailCustomerId: emailMatch.id,
        email: cleanEmail,
        phone: cleanPhone,
      })
    }

    const updatePayload: Record<string, string | null> = {
      full_name: fullName,
      first_name: cleanFirstName,
      last_name: cleanLastName,
      email: cleanEmail,
      phone: cleanPhone,
      updated_at: now,
    }
    if (notes !== undefined) {
      updatePayload.notes = notes
    }

    const { error } = await supabase
      .from('ops_customers')
      .update(updatePayload)
      .eq('id', existingCustomer.id)

    if (error) throw error

    return {
      id: existingCustomer.id,
      quickbooks_customer_id: existingCustomer.quickbooks_customer_id,
    }
  }

  const { data: newCustomer, error } = await supabase
    .from('ops_customers')
    .insert({
      full_name: fullName,
      first_name: cleanFirstName,
      last_name: cleanLastName,
      email: cleanEmail,
      phone: cleanPhone,
      notes: notes ?? null,
    })
    .select('id, quickbooks_customer_id')
    .single()

  if (error) throw error

  return {
    id: newCustomer.id,
    quickbooks_customer_id: newCustomer.quickbooks_customer_id,
  }
}
