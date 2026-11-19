import OpenAI from 'openai'
import { after } from 'next/server'
import WebSocket from 'ws'
import {
  issueCallToken,
  verifyCallToken,
} from '@/lib/phone-assistant/call-token'
import {
  bindVoiceProviderCall,
  markVoiceAnswered,
  getVoiceSessionDetails,
} from '@/lib/phone-assistant/records'
import { phoneGreeting, phoneInstructions } from '@/lib/phone-assistant/engine'
import { coachingInstructions } from '@/lib/phone-assistant/coaching'
import { createAdminClient } from '@/supabase/server'
import { queueBaseUrl } from '@/lib/twilio/appointment-queue'

export const maxDuration = 30

// Audio flows directly between Twilio and OpenAI. This short side connection
// asks the model to greet first and can close as soon as speech starts.
async function greet(providerId: string) {
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
    socket.once('open', () =>
      socket.send(
        JSON.stringify({
          type: 'response.create',
          response: {
            instructions: phoneGreeting,
          },
        }),
      ),
    )
    socket.on('message', (raw) => {
      const { type } = JSON.parse(raw.toString())
      if (type === 'response.output_audio.delta' || type === 'response.done')
        socket.close()
    })
    socket.on('error', () =>
      console.error('[Phone assistant] Opening greeting connection failed'),
    )
    socket.once('close', () => {
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
  const session = callSid && (await getVoiceSessionDetails(callSid))
  if (
    !session ||
    session.status !== 'active' ||
    !(await bindVoiceProviderCall(session.callSid, providerId))
  ) {
    await client.realtime.calls.reject(providerId, { status_code: 403 })
    return new Response(null, { status: 204 })
  }
  const instructions =
    phoneInstructions(session.pilot) +
    (await coachingInstructions(createAdminClient())) +
    '\nWhen a call is over, say goodbye before calling end_call. Offer the flood confirmation tool only for active water intrusion. Other requests for a person are callback messages. If the line goes silent, check once whether the caller is still there. If silence continues, say goodbye and end the call.'
  try {
    await client.realtime.calls.accept(
      providerId,
      {
        type: 'realtime',
        model: 'gpt-realtime-2.1',
        instructions,
        audio: {
          input: {
            turn_detection: {
              type: 'server_vad',
              silence_duration_ms: 650,
              idle_timeout_ms: 12000,
              interrupt_response: true,
              create_response: true,
            },
          },
          output: { voice: 'cedar', speed: 0.97 },
        },
        tools: [
          {
            type: 'mcp',
            server_label: 'sightings',
            server_url: queueBaseUrl() + '/api/phone-assistant/tools',
            authorization: issueCallToken(session.callSid, 'tools'),
            require_approval: 'never',
          },
        ],
      },
      { headers: { 'Idempotency-Key': event.id } },
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
  await markVoiceAnswered(session.callSid, providerId)
  after(() => greet(providerId))
  return new Response(null, { status: 204 })
}
