import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { opsPhoneLookupVariants } from '@/lib/ops/phone'
import { isDeliverableCustomerEmail } from '@/lib/ops/email'

const text = z.string().trim().min(1).max(150)
export const callerLookupSchema = z.object({
  first_name: text,
  last_name: text,
  street: text,
  unit: text.optional(),
})

type CallerInput = z.infer<typeof callerLookupSchema>

function words(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function street(value: string) {
  return words(value).replace(
    /\b(street|avenue|lane|road|court|drive|place|boulevard)\b/g,
    (word) =>
      ({
        street: 'st',
        avenue: 'ave',
        lane: 'ln',
        road: 'rd',
        court: 'ct',
        drive: 'dr',
        place: 'pl',
        boulevard: 'blvd',
      })[word]!,
  )
}

function unit(value?: string | null) {
  return words(value).replace(/^(unit|apt|apartment|suite|ste) /, '')
}

export async function recognizePhoneCaller(
  callerPhone: string,
  db: SupabaseClient,
  signal: AbortSignal,
) {
  const phones = opsPhoneLookupVariants(callerPhone)
  if (!phones.length) return false
  const { data, error } = await db
    .from('ops_customers')
    .select('id')
    .in('phone', phones)
    .limit(1)
    .abortSignal(signal)
  return !error && Boolean(data?.length)
}

// A phone number alone never populates customer details in model context. Even
// after verification, saved email stays server-side and only opaque IDs leave.
export async function verifiedCallerLocation(
  callerPhone: string,
  input: CallerInput,
  db: SupabaseClient,
) {
  const phones = opsPhoneLookupVariants(callerPhone)
  if (!phones.length) return null
  const customers = await db
    .from('ops_customers')
    .select('id,first_name,last_name,business_name,email')
    .in('phone', phones)
    .limit(2)
  if (customers.error) throw customers.error
  const c = customers.data?.length === 1 ? customers.data[0] : null
  if (
    !c ||
    c.business_name ||
    words(c.first_name) !== words(input.first_name) ||
    words(c.last_name) !== words(input.last_name)
  )
    return null
  const addresses = await db
    .from('ops_service_addresses')
    .select('id,street_1,street_2,city,state,zip_code')
    .eq('customer_id', c.id)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(100)
  if (addresses.error) throw addresses.error
  const matched = (addresses.data ?? []).filter(
    (a) =>
      a.street_1 &&
      street(a.street_1) === street(input.street) &&
      unit(a.street_2) === unit(input.unit) &&
      a.state?.toUpperCase() === 'CO' &&
      /^\d{5}$/.test(a.zip_code) &&
      a.city,
  )
  const a = matched[0]
  if (
    !a ||
    matched.some(
      (row) => row.zip_code !== a.zip_code || words(row.city) !== words(a.city),
    )
  )
    return null
  return { customer: c, address: a }
}

export async function lookupPhoneCaller(
  callerPhone: string,
  input: CallerInput,
  db: SupabaseClient,
) {
  const record = await verifiedCallerLocation(callerPhone, input, db)
  if (!record)
    return {
      status: 'no_verified_location',
      guidance:
        'Use the details the caller supplies. Never suggest a name or disclose any account information.',
    }
  return {
    status: 'verified_location',
    customer_ref: record.customer.id,
    service_address_ref: record.address.id,
    city: record.address.city,
    zip_code: record.address.zip_code,
    saved_email_available: isDeliverableCustomerEmail(record.customer.email),
    guidance:
      'Reuse the verified ZIP. Ask permission to use the email on file. Never read it aloud.',
  }
}
