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
