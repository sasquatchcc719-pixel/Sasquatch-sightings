import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { normalizeOpsPhone, opsPhoneLookupVariants } from '@/lib/ops/phone'
import { isDeliverableCustomerEmail } from '@/lib/ops/email'

const text = z.string().trim().min(1).max(150)
export const callerLookupSchema = z.object({
  first_name: text,
  last_name: text,
  street: text,
  unit: text
    .optional()
    .describe('Unit or suite the caller gave. Omit if there is none.'),
  business_name: text
    .optional()
    .describe(
      'Business named by the caller for a commercial visit. Omit for residential service.',
    ),
  city: text.optional(),
  zip_code: z
    .string()
    .regex(/^\d{5}$/)
    .optional(),
  email: z
    .email()
    .optional()
    .describe(
      'Only an email the caller supplied and spelled to distinguish matching profiles. Never guess it.',
    ),
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

export type GreetingMatch = { firstName: string | null }

export async function recognizePhoneCaller(
  callerPhone: string,
  db: SupabaseClient,
  signal: AbortSignal,
): Promise<GreetingMatch | null> {
  const phone = normalizeOpsPhone(callerPhone)
  if (!/^\+1\d{10}$/.test(phone)) return null
  const { data: rows, error } = await db
    .from('ops_customers')
    .select('first_name,full_name,last_name,business_name')
    .in('phone', opsPhoneLookupVariants(phone))
    .limit(31)
    .abortSignal(signal)
  if (error || !rows?.length) return null
  const neutral = { firstName: null }
  if (rows.length >= 31 || rows.some((row) => row.business_name)) return neutral
  const firstNames = rows.map((row) =>
    (
      String(row.first_name || '').trim() ||
      String(row.full_name || '')
        .trim()
        .split(/\s+/)[0]
    ).normalize('NFC'),
  )
  if (firstNames.some((name) => !/^\p{L}[\p{L}\p{M}’'-]{0,39}$/u.test(name)))
    return neutral
  const [first] = firstNames
  const surname = words(rows[0].last_name)
  if (
    rows.length > 1 &&
    (!surname ||
      rows.some(
        (row, i) =>
          words(row.last_name) !== surname ||
          words(firstNames[i]) !== words(first),
      ))
  )
    return neutral
  return { firstName: first }
}

// Search all profiles on the incoming line before deciding whether the supplied
// identity and service location identify a single destination for the email.
async function matchCallerLocation(
  callerPhone: string,
  input: CallerInput,
  db: SupabaseClient,
) {
  const noMatch = { status: 'no_verified_location' as const }
  const phones = opsPhoneLookupVariants(callerPhone)
  if (!phones.length) return noMatch
  const limit = 100
  const customers = await db
    .from('ops_customers')
    .select('id,first_name,last_name,business_name,is_commercial,email')
    .in('phone', phones)
    .order('created_at', { ascending: true })
    .order('id')
    .limit(limit + 1)
  if (customers.error) throw customers.error
  if (!customers.data || customers.data.length > limit) return noMatch
  const candidates = customers.data.filter(
    (c) =>
      words(c.first_name) === words(input.first_name) &&
      words(c.last_name) === words(input.last_name) &&
      words(c.business_name) === words(input.business_name) &&
      (Boolean(input.business_name) || !c.is_commercial),
  )
  if (!candidates.length) return noMatch
  const addresses = await db
    .from('ops_service_addresses')
    .select('id,customer_id,street_1,street_2,city,state,zip_code')
    .in(
      'customer_id',
      candidates.map((c) => c.id),
    )
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('id')
    .limit(limit + 1)
  if (addresses.error) throw addresses.error
  if (!addresses.data || addresses.data.length > limit) return noMatch
  const matches = candidates.flatMap((customer) =>
    addresses.data
      .filter(
        (a) =>
          a.customer_id === customer.id &&
          a.street_1 &&
          street(a.street_1) === street(input.street) &&
          unit(a.street_2) === unit(input.unit) &&
          a.state?.toUpperCase() === 'CO' &&
          /^\d{5}$/.test(a.zip_code) &&
          a.city,
      )
      .map((address) => ({ customer, address })),
  )
  if (!matches.length) return noMatch
  const places = new Set(
    matches.map((m) => words(m.address.city) + ':' + m.address.zip_code),
  )
  const located =
    places.size > 1
      ? matches.filter(
          ({ address }) =>
            (!input.zip_code || address.zip_code === input.zip_code) &&
            (!input.city || words(address.city) === words(input.city)),
        )
      : matches
  if (!located.length) return noMatch
  if (
    located.some(
      (m) =>
        words(m.address.city) !== words(located[0].address.city) ||
        m.address.zip_code !== located[0].address.zip_code,
    )
  )
    return { status: 'needs_location_confirmation' as const }
  const emailKey = (v: string | null) => (v ?? '').trim().toLowerCase()
  const first = located[0]
  const multiple = located.some((m) => m.customer.id !== first.customer.id)
  if (
    multiple &&
    (!z.email().safeParse(emailKey(first.customer.email)).success ||
      !isDeliverableCustomerEmail(first.customer.email) ||
      located.some(
        (m) => emailKey(m.customer.email) !== emailKey(first.customer.email),
      ))
  ) {
    const confirmed = emailKey(input.email ?? null)
    if (!confirmed) return { status: 'needs_email_confirmation' as const }
    const selected = located.find(
      (m) =>
        emailKey(m.customer.email) === confirmed &&
        isDeliverableCustomerEmail(confirmed),
    )
    if (!selected) return noMatch
    return { status: 'verified_location' as const, record: selected }
  }
  return { status: 'verified_location' as const, record: first }
}

export async function verifiedCallerLocation(
  callerPhone: string,
  input: CallerInput,
  db: SupabaseClient,
) {
  const match = await matchCallerLocation(callerPhone, input, db)
  return match.status === 'verified_location' ? match.record : null
}

export async function lookupPhoneCaller(
  callerPhone: string,
  input: CallerInput,
  db: SupabaseClient,
) {
  const match = await matchCallerLocation(callerPhone, input, db)
  if (match.status !== 'verified_location') {
    const guidance = {
      no_verified_location:
        'Ask the caller to spell their last name and confirm the street and unit, then retry once. Never suggest an identity or address. If still unmatched, use caller-provided information.',
      needs_location_confirmation:
        'Confirm the service city and ZIP, then retry with city and zip_code. If the location remains ambiguous, take an office callback.',
      needs_email_confirmation:
        'Ask the caller to spell the full email they use for this address, then retry with email. For booking pass that confirmed email and both references with use_saved_email false. Never reveal candidate emails.',
    }[match.status]
    return { status: match.status, guidance }
  }
  const { customer, address } = match.record
  const hasEmail =
    isDeliverableCustomerEmail(customer.email) &&
    z.email().safeParse(customer.email?.trim()).success
  return {
    status: 'verified_location',
    customer_ref: customer.id,
    service_address_ref: address.id,
    city: address.city,
    zip_code: address.zip_code,
    saved_email_available: hasEmail,
    guidance: hasEmail
      ? 'Reuse the verified ZIP. With the caller’s permission, use the saved email without reading it aloud. Keep both references for booking. If the caller spelled an email to resolve ambiguity, pass that confirmed email and use_saved_email false.'
      : 'Reuse the verified ZIP. Ask the caller to spell and confirm an email; there is no usable saved email.',
  }
}
