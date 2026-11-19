import OpenAI from 'openai'
import { after } from 'next/server'
import WebSocket from 'ws'
import {
  issueCallToken,
  verifyCallToken,
} from '@/lib/phone-assistant/call-token'
import {
  bindVoiceProviderCall,
  claimPreviewOpening,
  markVoiceAnswered,
  getVoiceSessionDetails,
} from '@/lib/phone-assistant/records'
import {
  phoneGreeting,
  phoneInstructions,
  phoneTools,
} from '@/lib/phone-assistant/engine'
import { coachingInstructions } from '@/lib/phone-assistant/coaching'
import { loadBookableCatalog } from '@/lib/ops/bookable-catalog'
import { createAdminClient } from '@/supabase/server'
import { queueBaseUrl } from '@/lib/twilio/appointment-queue'

import {
  dispatcherDelivery,
  previewCallbacksLocal,
  previewOpening,
  previewQuoteIntake,
  testProfile,
  testVoice,
  turnDetector,
} from '@/lib/phone-assistant/preview-profile'
import { openingGuard } from '@/lib/phone-assistant/preview-opening'

export const maxDuration = 30

// Audio flows directly between Twilio and OpenAI. This short side connection
// asks the model to greet first and can close as soon as speech starts.
async function greet(providerId: string, dispatcher: boolean) {
  await new Promise<void>((resolve) => {
    const socket = new WebSocket(
      'wss://api.openai.com/v1/realtime?call_id=' +
        encodeURIComponent(providerId),
      {
        headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
        handshakeTimeout: 4000,
      },
    )
    const timer = setTimeout(() => socket.terminate(), 6500)
    const open = () =>
      socket.send(
        JSON.stringify({
          type: 'response.create',
          response: {
            instructions: dispatcher
              ? dispatcherDelivery +
                ' Say exactly: “' +
                previewOpening +
                '” Then listen.'
              : phoneGreeting,
          },
        }),
      )
    const guard = dispatcher
      ? openingGuard(open, () => socket.close())
      : undefined
    socket.once('open', guard ? () => guard.event('connected') : open)
    socket.on('message', (raw) => {
      const { type } = JSON.parse(raw.toString())
      guard?.event(type)
      if (type === 'response.output_audio.delta' || type === 'response.done')
        socket.close()
    })
    socket.on('error', () =>
      console.error('[Phone assistant] Opening greeting connection failed'),
    )
    socket.once('close', () => {
      guard?.dispose()
      clearTimeout(timer)
      resolve()
    })
  })
}

export async function POST(request: Request) {
  const secret = process.env.HARRY_VOICE_WEBHOOK_SECRET
  if (!secret || !process.env.OPENAI_API_KEY)
    return new Response('Unconfigured', { status: 503 })
  const client = new OpenAI({ timeout: 8000, maxRetries: 0 })
  let event
  try {
    event = await client.webhooks.unwrap(
      await request.text(),
      request.headers,
      secret,
    )
  } catch {
    return new Response('Invalid signature', { status: 403 })
  }
  if (event.type !== 'realtime.call.incoming')
    return new Response(null, { status: 204 })
  const { call_id: providerId, sip_headers: headers } = event.data
  const invite =
    headers.find((h) => h.name.toLowerCase() === 'x-sightings-invite')?.value ??
    ''
  if (!invite) return new Response(null, { status: 204 })
  const callSid = verifyCallToken(invite, 'invite')
  const [session, coaching] = callSid
    ? await Promise.all([
        getVoiceSessionDetails(callSid),
        coachingInstructions(createAdminClient()),
      ])
    : [null, '']
  if (!session || session.status !== 'active') {
    await client.realtime.calls.reject(providerId, { status_code: 403 })
    return new Response(null, { status: 204 })
  }
  const profile = testProfile(session.pilot)
  if (
    profile !== 'current' &&
    !previewCallbacksLocal(request.url, queueBaseUrl())
  ) {
    await client.realtime.calls.reject(providerId, { status_code: 403 })
    console.error(
      '[Harry preview] Callback origin does not match isolated preview',
    )
    return new Response(null, { status: 204 })
  }
  const dispatcher = profile.startsWith('dispatcher-')
  // Fetch public unit rates alongside the existing binding. A slow catalog
  // falls back to the normal tool and does not hold up answering the phone.
  const [bound, catalog] = await Promise.all([
    bindVoiceProviderCall(session.callSid, providerId),
    dispatcher
      ? loadBookableCatalog(
          createAdminClient(),
          AbortSignal.timeout(600),
        ).catch(() => [])
      : [],
  ])
  if (!bound) {
    await client.realtime.calls.reject(providerId, { status_code: 403 })
    return new Response(null, { status: 204 })
  }
  const instructions =
    phoneInstructions(session.pilot, dispatcher) +
    coaching +
    (dispatcher ? previewQuoteIntake(catalog) : '') +
    '\nWhen a call is over, say goodbye before calling end_call. Offer the flood confirmation tool only for active water intrusion. Other requests for a person are callback messages. If the line goes silent, check once whether the caller is still there. If silence continues, say goodbye and end the call.'
  const accept = (detector: ReturnType<typeof turnDetector>, key: string) =>
    client.realtime.calls.accept(
      providerId,
      {
        type: 'realtime',
        model: 'gpt-realtime-2.1',
        instructions,
        audio: {
          input: {
            turn_detection: detector,
          },
          output: { voice: testVoice(profile), speed: 0.97 },
        },
        tools: [
          {
            type: 'mcp',
            server_label: 'sightings',
            server_url: queueBaseUrl() + '/api/phone-assistant/tools',
            authorization: issueCallToken(session.callSid, 'tools'),
            require_approval: 'never',
            ...(catalog.length &&
            catalog.every(
              (row) =>
                row.base_price !== null && Number.isFinite(row.base_price),
            )
              ? {
                  allowed_tools: [
                    ...phoneTools
                      .filter((tool) => tool.name !== 'phone_catalog')
                      .map((tool) => tool.name),
                    'request_flood_confirmation',
                    'end_call',
                  ],
                }
              : {}),
          },
        ],
      },
      { headers: { 'Idempotency-Key': key } },
    )

  const requested = turnDetector(profile)
  let effective = requested
  try {
    try {
      await accept(requested, event.id)
    } catch (error) {
      // A transport timeout or conflict can mean that accept already succeeded.
      // Retry a different body only for a definitive detector validation error.
      if (
        requested.type !== 'semantic_vad' ||
        !(error instanceof OpenAI.APIError) ||
        ![400, 422].includes(error.status ?? 0) ||
        !/turn_detection|semantic_vad|eagerness/i.test(
          (error.param ?? '') + ' ' + error.message,
        )
      )
        throw error
      console.warn(
        '[Harry preview] Semantic detector rejected; falling back to current server VAD',
      )
      effective = turnDetector('current')
      await accept(effective, event.id + '-server-vad')
    }
    if (profile !== 'current')
      console.info(
        '[Harry preview] Accepted profile',
        profile,
        effective.type,
        effective.type === 'semantic_vad'
          ? effective.eagerness
          : effective.silence_duration_ms,
        testVoice(profile),
        0.97,
      )
  } catch (err) {
    // A repeated incoming webhook may arrive after the call was accepted.
    if (
      err instanceof OpenAI.APIError &&
      err.status === 409 &&
      session.providerCallId === providerId &&
      session.answeredAt
    ) {
      return new Response(null, { status: 204 })
    }
    console.error(
      '[Phone assistant] Provider could not accept call',
      session.callSid,
      err instanceof OpenAI.APIError ? err.status : 'network',
    )
    return new Response('Could not accept voice call', { status: 503 })
  }
  const open =
    !dispatcher || (await claimPreviewOpening(session.callSid, providerId))
  await markVoiceAnswered(session.callSid, providerId)
  if (open) after(() => greet(providerId, dispatcher))
  return new Response(null, { status: 204 })
}
