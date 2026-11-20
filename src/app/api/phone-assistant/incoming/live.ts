import OpenAI from 'openai'
import { z } from 'zod'
import { loadBookableCatalog } from '@/lib/ops/bookable-catalog'
import { coachingInstructions } from '@/lib/phone-assistant/coaching'
import {
  issueCallToken,
  verifyCallToken,
} from '@/lib/phone-assistant/call-token'
import { phoneTools, recognizePhoneCaller } from '@/lib/phone-assistant/engine'
import {
  liveInviteHeader,
  liveInvitePurpose,
  liveVoiceEnabled,
  liveVoiceSession,
} from '@/lib/phone-assistant/live-preview'
import {
  bindVoiceProviderCall,
  getVoiceSessionDetails,
  markVoiceAnswered,
} from '@/lib/phone-assistant/records'
import { queueBaseUrl } from '@/lib/twilio/appointment-queue'
import { createAdminClient } from '@/supabase/server'

const liveIncoming = z.object({
  id: z.string().min(1),
  type: z.literal('live.transport.incoming'),
  data: z.object({
    type: z.literal('sip'),
    session_id: z.string().min(1),
    sip_headers: z.array(z.object({ name: z.string(), value: z.string() })),
  }),
})
const ignored = () => new Response(null, { status: 204 })

export async function handleLiveIncoming(
  event: unknown,
  url: string,
  client: OpenAI,
) {
  // The installed SDK verifies signatures but predates Live's event and methods.
  // Validate the documented payload and use its authenticated HTTP client.
  const parsed = liveIncoming.safeParse(event)
  if (!parsed.success) return ignored()
  const base = queueBaseUrl()
  if (!liveVoiceEnabled(true, url, base)) return ignored()
  const { session_id: providerId, sip_headers: headers } = parsed.data.data
  const invites = headers.filter(
    (h) => h.name.toLowerCase() === liveInviteHeader.toLowerCase(),
  )
  if (
    invites.length !== 1 ||
    headers.some((h) => h.name.toLowerCase() === 'x-sightings-invite')
  )
    return ignored()
  const sid = verifyCallToken(invites[0].value, liveInvitePurpose(base))
  if (!sid) return ignored()
  const session = await getVoiceSessionDetails(sid)
  // Never decide a stale or foreign call. The signed session was created only
  // after the private-preview or public-answering access check succeeded.
  if (!session || session.status !== 'active') return ignored()
  if (!liveVoiceEnabled(session.pilot, url, base)) return ignored()
  if (session.providerCallId === providerId && session.answeredAt)
    return ignored()
  const path = '/live/sessions/' + encodeURIComponent(providerId)
  if (!(await bindVoiceProviderCall(sid, providerId))) {
    await client
      .post(path + '/reject', { body: { status_code: 403 } })
      .asResponse()
    return ignored()
  }
  const db = createAdminClient()
  const [catalog, coaching, caller] = await Promise.all([
    loadBookableCatalog(db, AbortSignal.timeout(600)).catch(() => []),
    coachingInstructions(db),
    recognizePhoneCaller(
      session.callerPhone,
      db,
      AbortSignal.timeout(600),
    ).catch(() => null),
  ])
  const completeCatalog =
    catalog.length > 0 &&
    catalog.every(
      (row) => row.base_price !== null && Number.isFinite(row.base_price),
    )
  const names = phoneTools
    .filter((tool) => !completeCatalog || tool.name !== 'phone_catalog')
    .map((tool) => tool.name)
  const config = liveVoiceSession(
    catalog,
    coaching,
    {
      server_url: base + '/api/phone-assistant/tools',
      authorization: issueCallToken(
        sid,
        'tools',
        Date.parse(session.startedAt),
      ),
      allowed_tools: [...names, 'request_flood_confirmation', 'end_call'],
    },
    caller,
    session.pilot,
  )
  try {
    await client
      .post(path + '/accept', {
        headers: { 'Idempotency-Key': 'harry-live-' + parsed.data.id },
        body: { session: config },
      })
      .asResponse()
  } catch (err) {
    if (err instanceof OpenAI.APIError && err.status === 409) {
      const latest = await getVoiceSessionDetails(sid)
      if (latest?.providerCallId === providerId && latest.answeredAt)
        return ignored()
    }
    console.error(
      '[Harry preview] Live SIP accept failed',
      err instanceof OpenAI.APIError ? err.status : 'network',
    )
    return new Response('Could not accept voice call', { status: 503 })
  }
  if (!(await markVoiceAnswered(sid, providerId)))
    return new Response('Could not mark voice call answered', { status: 503 })
  return ignored()
}
