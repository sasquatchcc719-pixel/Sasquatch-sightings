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

export function previewQuoteIntake(catalog: BookableCatalogRow[]) {
  const unitRates = catalog
    .filter((row) => row.base_price !== null && Number.isFinite(row.base_price))
    .map((row) => [
      row.id,
      row.category,
      row.name,
      row.base_price,
      row.pricing_unit,
    ])
  return (
    '\nFor a simple item price, answer with the matching unit rate and what it covers. For a generic price question like “How much to clean my couch?”, give the standard three-seat sofa as a clearly labeled example if it is listed. The caller can clarify if theirs is different. Once the caller asks for a combined estimate or asks to book, ask for the first missing quote input immediately. If the work is described and ZIP is missing, ask just “What ZIP code is the job in?” and yield. Skip the setup line. Confirm any unresolved furniture type before quoting the whole job. When the caller already supplied a room size, carry it forward. Never promise to calculate an estimate before you have its required inputs. When asked why, answer the question directly and let the caller respond.' +
    (unitRates.length
      ? '\nCurrent public catalog rows [service ID, category, service, base price in USD, unit]. Use these rows directly for item-price questions and service IDs. Look up only missing items. Always use phone_quote or phone_openings for an actual job total.\n' +
        JSON.stringify(unitRates)
      : '')
  )
}
