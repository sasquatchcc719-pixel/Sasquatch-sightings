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
    process.env.VERCEL_ENV === 'development'
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
  'Speak like a relaxed local dispatcher. Match the caller’s pace. Use one natural thought at a time, usually one or two short sentences, and at most one question. An occasional quiet “yeah” or “uh-huh” after a completed thought is fine. Most answers can start directly. Never talk just to fill a pause or add acknowledgment sounds while the caller is still speaking.'

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

export function previewQuoteIntake(catalog: BookableCatalogRow[]) {
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
  return (
    '\nOrdinary pricing turns use only the words needed for the answer or question. For a listed unit price, state the item and price, and stop. For a generic price question like “How much to clean my couch?”, give the standard three-seat sofa as a clearly labeled example if it is listed. The caller can clarify if theirs is different. Once the caller asks for a combined estimate or asks to book, ask for the first missing quote input immediately. If the work is described and ZIP is missing, ask just “What ZIP code is the job in?” and yield. That ZIP question is the entire turn, even after the caller adds work. Confirm any unresolved furniture type before quoting the whole job. When the caller already supplied a room size, carry it forward. Once all inputs are present, silently call phone_quote and speak the returned amount. Routine price lookups get zero preamble. Reserve hold lines for genuinely slow calendar searches. If asked for the final price with no verified lead source yet, ask how they heard about us. A standard estimate is provisional. Never affirm that it is final. After a corrected date, check the corrected date before offering a time or reporting failure. When asked why, answer the question directly and let the caller respond.' +
    (unitRates.length
      ? '\nCurrent public catalog rows [service ID, category, service, base price in USD, unit]. Use these rows directly for item-price questions and service IDs. Look up only missing items. Always use phone_quote or phone_openings for an actual job total.\n' +
        JSON.stringify(unitRates)
      : '')
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
    return { ...value, price_guidance: guidance }
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
