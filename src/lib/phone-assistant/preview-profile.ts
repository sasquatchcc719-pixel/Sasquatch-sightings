import type { BookableCatalogRow } from '@/lib/ops/bookable-catalog'

// These are operator-selected profiles for isolated preview environments.
// Neither keypad digits, SIP headers nor tool arguments can select a profile.
const testProfiles = [
  'detector-medium',
  'detector-low',
  'dispatcher-server',
  'dispatcher-medium',
  'dispatcher-low',
] as const
export type TestProfile = 'current' | (typeof testProfiles)[number]
export function testProfile(pilot: boolean): TestProfile {
  const isolated =
    process.env.VERCEL_ENV === 'preview' ||
    (!process.env.VERCEL_ENV && process.env.NODE_ENV !== 'production') ||
    process.env.VERCEL_ENV === 'development' ||
    (process.env.VERCEL_ENV === 'production' &&
      process.env.HARRY_VOICE_TEST_TRANSPORT === 'live')
  if (!pilot || !isolated) return 'current'
  const name = process.env.HARRY_VOICE_TEST_PROFILE
  if (!name || name === 'current') return 'current'
  const selected = testProfiles.find((profile) => profile === name)
  if (!selected)
    console.warn('[Harry preview] Unknown test profile; using current')
  return selected ?? 'current'
}

export function turnDetector(profile: TestProfile) {
  const common = { create_response: true, interrupt_response: true }
  if (profile === 'current' || profile === 'dispatcher-server')
    return {
      ...common,
      type: 'server_vad' as const,
      silence_duration_ms: 500,
      idle_timeout_ms: 12000,
    }
  return {
    ...common,
    type: 'semantic_vad' as const,
    eagerness: profile.endsWith('-low')
      ? ('low' as const)
      : ('medium' as const),
  }
}
export function testVoice(profile: TestProfile) {
  const voice = process.env.HARRY_VOICE_TEST_VOICE
  return profile.startsWith('dispatcher-') &&
    (voice === 'ash' || voice === 'echo')
    ? voice
    : 'cedar'
}

export const previewOpening =
  'Thanks for calling Sasquatch Carpet Cleaning. I’m Harry, the virtual assistant. This is a test call, so nothing will be booked. How can I help?'
export const dispatcherDelivery =
  'Sound like a calm local dispatcher. Give one short answer or ask one question, then listen. Yield to interruptions. An occasional quiet “yeah” is fine.'

// Candidate callbacks and the call-scoped MCP token belong to this preview.
export function previewCallbacksLocal(requestUrl: string, base: string) {
  const incoming = new URL(requestUrl)
  return (
    incoming.hostname !== 'sightings.sasquatchcarpet.com' &&
    incoming.origin === new URL(base).origin
  )
}

export function catalogServiceCodes(catalog: BookableCatalogRow[]) {
  const codes = new Map<string, string>()
  const duplicates = new Set<string>()
  for (const row of catalog) {
    if (!row.slug) continue
    if (codes.has(row.slug)) duplicates.add(row.slug)
    codes.set(row.slug, row.id)
  }
  for (const slug of duplicates) codes.delete(slug)
  return codes
}

export function dispatcherInstructions(
  catalog: BookableCatalogRow[],
  coaching = '',
) {
  const codes = catalogServiceCodes(catalog)
  const unitRates = catalog
    .filter((row) => row.base_price !== null && Number.isFinite(row.base_price))
    .map((row) => [
      row.slug && codes.get(row.slug) === row.id ? row.slug : row.id,
      row.category,
      row.name,
      row.base_price,
      row.pricing_unit,
    ])
  const day = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Denver',
  })
  const rules = `You're Harry, Sasquatch Carpet Cleaning’s after-hours virtual assistant. Today is ${day} in Mountain Time. ${dispatcherDelivery}
The opening plays once. If interrupted, briefly disclose the AI and simulated booking before discussing an action. Ignore background noise. After prolonged silence check once, then say goodbye and end_call.

Use what the caller already gave you. A correction replaces only that detail. Give a listed unit price directly (for a generic couch, the standard three-seat example). For a job estimate, ask only for missing services, sizes or ZIP. If only ZIP is missing, say “What ZIP code is the job in?”
Silently use phone_quote for totals. For price and earliest availability together, call phone_openings once with the whole job and no dates. Use phone_quoted_openings only for a subsequent availability request after a price-only quote. For commercial work check a measuring visit. Give the verified price or opening immediately, then wait. One short hold line is enough for a slow calendar. If a lookup fails, offer a message. Discard superseded results.
When the caller wants to book, call phone_caller_lookup before asking for contact details. It checks the actual incoming number; never ask them to repeat that number. Include any name they already gave you. If the number is known but no name was supplied, ask for the name on the account without listing saved names. For a match, briefly confirm their name and the saved street they want. Do not read their email aloud. Copy the selected location's customer_ref and service_address_ref into phone_preview_booking. If no saved location applies, reuse customer_ref and collect the new address. Only collect email and full contact details for a true no_match.
Use the tool’s standard estimate until final pricing is verified. Explain a minimum and get acceptance only when applied. Keep the caller’s coupon when repricing. For a final price, ask how they heard about us if still unknown. Google Maps means regular search; clarify “Google” alone. Apply only the verified LSA fee. Recheck any changed price or slot.
On a later turn near the end of a residential quote, ask once about pet urine treatment, rugs, furniture and tile. Skip if declined or wrapping up. Confirm date, time, address, final amount and callback number before a simulated booking. Verify changes by confirmation code, surname and incoming number. Never claim a real booking, transfer, payment or message delivery.

If they want a person or to leave a message, take their note, name and callback preference. Thank them aloud and say goodbye before end_call. Only confirmed active flooding goes to the emergency keypad. Decline sales and hang up; clarify unclear recorded speech once. Protect other customers’ details and never collect payment information.`
  return (
    rules +
    coaching +
    (unitRates.length
      ? '\nCurrent public catalog rows [service ID, category, name, USD rate, unit]:\n' +
        JSON.stringify(unitRates)
      : '\nUse phone_catalog for missing unit prices and service IDs.')
  )
}

// Keep the scope of a tool result attached to the result itself. An unsubmitted
// coupon has no eligibility decision, and one date's failure says nothing about another.
export function previewToolResult(name: string, value: unknown) {
  if (typeof value !== 'object' || !value) return value
  if (name === 'phone_quote' && 'total' in value) {
    const coupon = 'coupon' in value ? value.coupon : null
    const submitted =
      coupon && typeof coupon === 'object' && 'code' in coupon && coupon.code
    const guidance = submitted
      ? 'This amount includes the returned coupon decision. Give the price and let the caller respond.'
      : 'No coupon was submitted or evaluated on this calculation. If a coupon was supplied earlier, reprice with the same coupon and current source before answering. Never describe an omitted coupon as rejected.'
    const provisional =
      'status' in value && value.status === 'standard_estimate'
    return {
      ...value,
      price_guidance: provisional
        ? guidance +
          ' Standard estimate only. If asked for a final price, ask how the caller heard about us, then reprice with their source and coupon.'
        : guidance,
    }
  }
  if (
    (name === 'phone_openings' || name === 'phone_quoted_openings') &&
    'date' in value &&
    typeof value.date === 'string' &&
    'times' in value &&
    Array.isArray(value.times) &&
    value.times.length
  ) {
    return {
      ...value,
      verified_opening: { date: value.date, time: value.times[0] },
      reply_guidance:
        'If this is the requested date, answer with this verified opening. Earlier errors for other dates do not apply.',
    }
  }
  return value
}
