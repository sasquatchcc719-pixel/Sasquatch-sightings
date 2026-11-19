import type { BookableCatalogRow } from '@/lib/ops/bookable-catalog'
import {
  dispatcherInstructions,
  previewCallbacksLocal,
  testProfile,
} from './preview-profile'

export const liveInviteHeader = 'X-Sightings-Live-Invite'

export function livePreviewEnabled(
  pilot: boolean,
  requestUrl: string,
  base: string,
) {
  return (
    pilot &&
    (process.env.VERCEL_ENV === 'preview' ||
      process.env.VERCEL_ENV === 'production') &&
    process.env.HARRY_VOICE_TEST_TRANSPORT === 'live' &&
    testProfile(pilot) === 'dispatcher-server' &&
    new URL(base).protocol === 'https:' &&
    (process.env.VERCEL_ENV === 'production'
      ? new URL(requestUrl).origin === new URL(base).origin
      : previewCallbacksLocal(requestUrl, base))
  )
}

// A different hostname or the ordinary Realtime invitation cannot claim this call.
export function liveInvitePurpose(base: string): `live-invite:${string}` {
  return `live-invite:${new URL(base).origin}`
}

export function livePreviewSession(
  catalog: BookableCatalogRow[],
  coaching: string,
  mcp: {
    server_url: string
    authorization: string
    allowed_tools: string[]
  },
) {
  const instructions = `You are Harry, the after-hours virtual assistant at Sasquatch Carpet Cleaning. Sound like a relaxed local dispatcher. One brief answer or one question, then listen. Stop immediately for a caller who speaks or corrects you; keep their latest details. Never answer background speech. The caller has heard the test and transcription notice. You can take a message or help right now. Nothing will actually be booked, changed or transferred.
Ask only for missing job details. If the only missing detail is ZIP, ask “What ZIP code is the job in?” Delegate item prices, quotes, coupons, appointment times, caller-record lookup and business actions to the backend. Let a routine lookup run silently. When they want to book, have the backend check the verified incoming number before asking for contact details. If a record matches, confirm their name and saved service street; do not ask again for saved email or phone. Give the verified result first. For a price and opening, use two short phrases: “About [full dollar amount] dollars. First opening is [weekday, date] at [time].” Say the full amount, including “hundred” when applicable. Then listen. Skip the service recap and scheduling preamble. On a later turn near the end of a residential quote, ask once about pet urine treatment, rugs, furniture and tile. Skip extras on messages, emergency calls and when declined. Ask about lead source near the end. For a person, take a message; only confirmed active flooding can go to the emergency keypad. Say goodbye aloud before delegating a hangup.`
  return {
    type: 'live',
    model: 'gpt-live-1.1',
    instructions,
    audio: { output: { voice: 'meridian' } },
    // SIP negotiates its own audio format. A single startup message opens the
    // connected conversation. Nothing schedules a second greeting on retry.
    input: [
      {
        type: 'message',
        role: 'developer',
        content: [
          {
            type: 'input_text',
            text: 'Greet the caller now in English: “Harry here. Want to leave a message, or can I help with something?” Then listen. If the caller has already begun speaking, listen and answer their request instead. Do not repeat the opening.',
          },
        ],
      },
    ],
    delegation: {
      type: 'responses',
      responses: {
        model: 'gpt-6-luna',
        instructions:
          dispatcherInstructions(catalog, coaching) +
          '\nYou handle delegated business work. Return the verified fact, missing detail, or simulated result concisely to Harry. Never guess or treat an interrupted request as current.',
        tool_choice: 'auto',
        parallel_tool_calls: false,
        tools: [
          {
            type: 'mcp',
            server_label: 'sightings',
            ...mcp,
            require_approval: 'never',
          },
        ],
      },
    },
  }
}
