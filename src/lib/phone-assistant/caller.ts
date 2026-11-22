import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { normalizeOpsPhone, opsPhoneLookupVariants } from '@/lib/ops/phone'
import { isDeliverableCustomerEmail } from '@/lib/ops/email'

const text = z.string().trim().min(1).max(150)
export const callerLookupSchema = z.object({
  first_name: text,
  last_name: text
    .optional()
    .describe(
      'Omit for a recognized residential caller unless volunteered or the lookup asks for it.',
    ),
  street: text,
  unit: z
    .string()
    .trim()
    .max(150)
    .optional()
    .describe(
      'Use only a unit the caller gave. Omit if unknown. Use an empty string only when the caller explicitly confirms there is no unit.',
    ),
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

export const usualAddressSchema = z.object({
  first_name: text,
  first_name_confirmed: z
    .literal(true)
    .describe('The caller just affirmed the first name in Harry’s greeting.'),
})

const addressColumns = 'id,customer_id,street_1,street_2,city,state,zip_code'
const matchLimit = 100

function currentMountainDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
}

function completedServicesAt(
  db: SupabaseClient,
  customers: string[],
  sites: string[],
) {
  return db
    .from('ops_appointments')
    .select('customer_id,service_address_id,appointment_date')
    .in('customer_id', customers)
    .in('service_address_id', sites)
    .eq('kind', 'service')
    .eq('status', 'completed')
    .is('parked_at', null)
    .lte('appointment_date', currentMountainDate())
    .order('appointment_date', { ascending: false })
    .order('id')
    .limit(matchLimit + 1)
}

export async function proposeUsualAddress(
  callerPhone: string,
  input: z.infer<typeof usualAddressSchema>,
  db: SupabaseClient,
) {
  const fallback = {
    status: 'ask_for_street' as const,
    guidance: 'Ask only for the street for this visit.',
  }
  const phone = normalizeOpsPhone(callerPhone)
  if (!input.first_name_confirmed || !/^\+1\d{10}$/.test(phone)) return fallback
  const { data: profiles, error } = await db
    .from('ops_customers')
    .select(
      'id,first_name,last_name,full_name,business_name,email,is_commercial',
    )
    .in('phone', opsPhoneLookupVariants(phone))
    .limit(matchLimit + 1)
  if (error) throw error
  if (!profiles?.length || profiles.length > matchLimit) return fallback
  const first = profiles[0]
  if (
    profiles.some(
      (p) =>
        p.is_commercial ||
        p.business_name ||
        words(p.first_name) !== words(input.first_name),
    )
  )
    return fallback
  // A household or business number must never select another person's address.
  if (
    profiles.length > 1 &&
    (!words(first.last_name) ||
      !isDeliverableCustomerEmail(first.email) ||
      profiles.some(
        (p) =>
          words(p.last_name) !== words(first.last_name) ||
          p.email?.trim().toLowerCase() !== first.email.trim().toLowerCase(),
      ))
  )
    return fallback
  const ids = profiles.map((p) => p.id)
  const { data: rows, error: siteError } = await db
    .from('ops_service_addresses')
    .select(addressColumns)
    .in('customer_id', ids)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('id')
    .limit(matchLimit + 1)
  if (siteError) throw siteError
  if (!rows?.length || rows.length > matchLimit) return fallback
  const sites = rows.filter(
    (a) =>
      ids.includes(a.customer_id) &&
      a.state?.toUpperCase() === 'CO' &&
      a.city &&
      /^\d{5}$/.test(a.zip_code) &&
      /^\d+[a-z]?\s+\S/iu.test(street(a.street_1)),
  )
  if (!sites.length) return fallback
  const place = (a: (typeof sites)[number]) =>
    JSON.stringify([
      street(a.street_1),
      unit(a.street_2),
      words(a.city),
      a.zip_code,
    ])
  let site = sites[0]
  if (new Set(sites.map(place)).size > 1) {
    const history = await completedServicesAt(
      db,
      ids,
      sites.map((a) => a.id),
    )
    if (history.error || !history.data?.length) return fallback
    const jobs = history.data
    const latest = jobs[0].appointment_date
    if (
      jobs.length > matchLimit &&
      jobs[jobs.length - 1].appointment_date === latest
    )
      return fallback
    const visited = sites.filter((a) =>
      jobs.some(
        (j) =>
          j.appointment_date === latest &&
          j.customer_id === a.customer_id &&
          j.service_address_id === a.id,
      ),
    )
    if (!visited.length || new Set(visited.map(place)).size !== 1)
      return fallback
    site = visited[0]
  }
  const sameStreet = sites.filter(
    (a) =>
      street(a.street_1) === street(site.street_1) &&
      unit(a.street_2) === unit(site.street_2),
  )
  const distinguishTown = sameStreet.some(
    (a) => words(a.city) !== words(site.city) || a.zip_code !== site.zip_code,
  )
  return {
    status: 'confirm_saved_street' as const,
    street: site.street_1,
    ...(site.street_2 && { unit: site.street_2 }),
    ...(distinguishTown && { city: site.city, zip_code: site.zip_code }),
    guidance:
      'Ask one question confirming this service address. If confirmed, use it in phone_caller_lookup with the first name and any returned locality. If corrected, use the caller’s new address instead.',
  }
}

// Search all profiles on the incoming line before deciding whether the supplied
// identity and service location identify a single destination for the email.
async function matchCallerLocation(
  callerPhone: string,
  input: CallerInput,
  db: SupabaseClient,
) {
  const noMatch = { status: 'no_verified_location' as const }
  const phone = normalizeOpsPhone(callerPhone)
  if (!/^\+1\d{10}$/.test(phone)) return noMatch
  const phones = opsPhoneLookupVariants(phone)
  const streetKey = street(input.street)
  if (
    !input.last_name &&
    (input.business_name || !/^\d+[a-z]?\s+\S/iu.test(streetKey))
  ) {
    return { status: 'needs_name_confirmation' as const }
  }
  const limit = matchLimit
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
      (input.last_name === undefined ||
        words(c.last_name) === words(input.last_name)) &&
      words(c.business_name) === words(input.business_name) &&
      (Boolean(input.business_name) || !c.is_commercial),
  )
  if (!candidates.length) return noMatch
  const addresses = await db
    .from('ops_service_addresses')
    .select(addressColumns)
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
          street(a.street_1) === streetKey &&
          (!input.city || words(a.city) === words(input.city)) &&
          (!input.zip_code || a.zip_code === input.zip_code) &&
          a.state?.toUpperCase() === 'CO' &&
          /^\d{5}$/.test(a.zip_code) &&
          a.city,
      )
      .map((address) => ({ customer, address })),
  )
  if (!matches.length) return noMatch
  if (
    !input.last_name &&
    (matches.some((m) => !words(m.customer.last_name)) ||
      new Set(matches.map((m) => words(m.customer.last_name))).size !== 1)
  ) {
    return { status: 'needs_name_confirmation' as const }
  }
  if (
    input.unit === undefined &&
    matches.some((m) => unit(m.address.street_2))
  ) {
    return { status: 'needs_unit_confirmation' as const }
  }
  let located = matches.filter(
    (m) => unit(m.address.street_2) === unit(input.unit),
  )
  if (!located.length) return noMatch
  const zips = new Set(located.map((m) => m.address.zip_code))
  if (zips.size > 1)
    return {
      status: 'needs_location_confirmation' as const,
      missing_field: 'zip_code' as const,
    }
  if (new Set(located.map((m) => words(m.address.city))).size > 1) {
    // Legacy rows can disagree on a town label within one ZIP. Only actual
    // completed service for this customer at this exact street/unit can settle it.
    const customerIds = [...new Set(located.map((m) => m.customer.id))]
    if (customerIds.length === 1) {
      const history = await completedServicesAt(
        db,
        customerIds,
        located.map((m) => m.address.id),
      )
      if (!history.error && history.data && history.data.length <= limit) {
        const serviced = new Set(
          history.data
            .filter((j) => j.customer_id === customerIds[0])
            .map((j) => j.service_address_id),
        )
        const cities = new Set(
          located
            .filter((m) => serviced.has(m.address.id))
            .map((m) => words(m.address.city)),
        )
        if (cities.size === 1)
          located = located.filter((m) => cities.has(words(m.address.city)))
      }
    }
    if (new Set(located.map((m) => words(m.address.city))).size > 1) {
      return {
        status: 'needs_location_confirmation' as const,
        missing_field: 'city' as const,
      }
    }
  }
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
        'The supplied details do not match a saved location. Confirm only the disputed detail or use the new-address flow if the caller is giving a different location.',
      needs_name_confirmation:
        'Ask only for the surname, then retry with the existing street. Do not ask for the rest of the address.',
      needs_unit_confirmation:
        'Ask only for the apartment or suite. If the caller explicitly confirms no unit, pass unit as an empty string and retry.',
      needs_location_confirmation:
        'missing_field' in match && match.missing_field === 'city'
          ? 'Ask only for the city. The ZIP is already known.'
          : 'Ask only for the ZIP code. Keep the supplied street.',
      needs_email_confirmation:
        'Ask the caller to spell the full email they use for this address, then retry with email. For booking pass that confirmed email and both references with use_saved_email false. Never reveal candidate emails.',
    }[match.status]
    return {
      status: match.status,
      ...(match.status === 'needs_location_confirmation' && {
        missing_field: match.missing_field,
      }),
      guidance,
    }
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
      ? 'Use the saved city and ZIP for pricing, availability and booking. Do not ask for the address again. If the caller only asked whether their information is on file, confirm and stop. When booking, with the caller’s permission, use the saved email without reading it aloud. Keep both references for booking. If the caller spelled an email to resolve ambiguity, pass that confirmed email and use_saved_email false.'
      : 'Reuse the verified ZIP. Ask the caller to spell and confirm an email; there is no usable saved email.',
  }
}
