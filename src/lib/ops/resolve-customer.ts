import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeOpsPhone, opsPhoneLookupVariants } from '@/lib/ops/phone'

/**
 * Find or create a customer, matching on phone.
 *
 * Extracted from the booking route so the restoration intake does not grow a
 * second, subtly different copy. Matching on phone rather than name is what
 * stops a repeat caller becoming a duplicate record.
 *
 * One deliberate difference from carpet cleaning booking: **email is optional
 * here.** A flood call is someone panicking on the phone, and refusing to open
 * the job because they did not spell out an email address would be absurd.
 */

export type CustomerInput = {
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  business_name?: string | null
  phone?: string | null
  email?: string | null
  notes?: string | null
}

export type ResolveCustomerResult =
  | { ok: true; customerId: string; created: boolean }
  | { ok: false; error: string }

export function deriveCustomerName(input: CustomerInput): {
  fullName: string
  firstName: string
  lastName: string
} {
  const firstName = String(input.first_name ?? '').trim()
  const lastName = String(input.last_name ?? '').trim()
  const explicit = String(input.full_name ?? '').trim()
  const fullName = explicit || [firstName, lastName].filter(Boolean).join(' ').trim()

  // A single typed name still has to split, because the column pair is used
  // elsewhere for greetings and sorting.
  if (!firstName && !lastName && fullName) {
    const parts = fullName.split(/\s+/)
    return {
      fullName,
      firstName: parts[0] ?? '',
      lastName: parts.slice(1).join(' '),
    }
  }

  return { fullName, firstName, lastName }
}

export async function resolveOrCreateCustomer(
  supabase: SupabaseClient,
  params: { customerId?: string | null; customer?: CustomerInput | null },
): Promise<ResolveCustomerResult> {
  const input = params.customer ?? {}
  const { fullName, firstName, lastName } = deriveCustomerName(input)
  // normalizeOpsPhone('') returns '+', which is truthy and matches any other
  // record stored with that same junk value — so a customer with no phone would
  // silently resolve to somebody else's record. Validate the digits first.
  const rawPhone = String(input.phone ?? '').trim()
  const hasRealPhone = rawPhone.replace(/\D/g, '').length >= 10
  const phone = hasRealPhone ? normalizeOpsPhone(rawPhone) : ''
  const email = input.email ? String(input.email).trim() : null
  const businessName = input.business_name ? String(input.business_name).trim() : null
  const notes = input.notes ? String(input.notes) : null

  const patch = {
    full_name: fullName,
    first_name: firstName,
    last_name: lastName,
    business_name: businessName,
    email,
    phone,
    notes,
    updated_at: new Date().toISOString(),
  }

  if (params.customerId) {
    const { data: existing } = await supabase
      .from('ops_customers')
      .select('id')
      .eq('id', params.customerId)
      .maybeSingle()
    if (!existing) return { ok: false, error: 'customer_not_found' }
    return { ok: true, customerId: existing.id, created: false }
  }

  if (!fullName) return { ok: false, error: 'customer name is required' }
  if (!phone) return { ok: false, error: 'customer phone is required' }


  const { data: matches } = await supabase
    .from('ops_customers')
    .select('id')
    .in('phone', opsPhoneLookupVariants(phone))
    .order('updated_at', { ascending: false })
    .limit(1)

  const match = matches?.[0]
  if (match) {
    // Known number: keep the existing record and freshen anything supplied,
    // rather than creating a duplicate for the same person.
    await supabase.from('ops_customers').update(patch).eq('id', match.id)
    return { ok: true, customerId: match.id, created: false }
  }

  const { data: created, error } = await supabase
    .from('ops_customers')
    .insert({
      full_name: fullName,
      first_name: firstName,
      last_name: lastName,
      business_name: businessName,
      email,
      phone,
      notes,
    })
    .select('id')
    .single()

  if (error || !created) return { ok: false, error: error?.message ?? 'insert failed' }
  return { ok: true, customerId: created.id, created: true }
}
