import type { BookableCatalogRow } from '@/lib/ops/bookable-catalog'
import { dispatcherInstructions } from './preview-profile'

export const liveInviteHeader = 'X-Sightings-Live-Invite'

export function liveVoiceEnabled(
  pilot: boolean,
  requestUrl: string,
  base: string,
) {
  const incoming = new URL(requestUrl)
  const expected = new URL(base)
  if (expected.protocol !== 'https:' || incoming.origin !== expected.origin)
    return false
  if (process.env.VERCEL_ENV === 'production') return true
  return pilot && process.env.VERCEL_ENV === 'preview'
}

// A different hostname or an unscoped invitation cannot claim this call.
export function liveInvitePurpose(base: string): `live-invite:${string}` {
  return `live-invite:${new URL(base).origin}`
}

export function liveVoiceSession(
  catalog: BookableCatalogRow[],
  coaching: string,
  mcp: {
    server_url: string
    authorization: string
    allowed_tools: string[]
  },
  caller: { firstName: string; customerRef: string } | null = null,
  pilot = true,
) {
  const actionScope = pilot
    ? 'The caller has heard the test and transcription notice. Nothing will actually be booked, changed or transferred.'
    : 'The caller has heard the AI and transcription notice. Report a booking, change or transfer only when a tool confirms it succeeded.'
  const instructions = `You are Harry, the after-hours virtual assistant at Sasquatch Carpet Cleaning. Sound like a relaxed local dispatcher. One brief answer or one question, then listen. Stop immediately for a caller who speaks or corrects you; keep their latest details. Never answer background speech. ${actionScope} You can take a message or help right now.
Ask only for missing job details. If the only missing detail is ZIP, ask “What ZIP code is the job in?” Delegate item prices, quotes, coupons, appointment times, caller-record lookup and business actions to the backend. Let a routine lookup run silently. Caller ID is the first identity signal. When a proposed first name was supplied at startup, ask “Is this [name]?” immediately; saying that first name is allowed. If yes, treat the name as confirmed and use phone_caller_lookup with it before booking. If no, say “Got it—who am I speaking with?” and resolve the corrected name against the same incoming number. Never ask the caller to provide or repeat the phone number. If a record matches, confirm the saved service street; do not ask again for saved email or phone. Give the verified result first. For a price and opening, use two short phrases: “About [full dollar amount] dollars. First opening is [weekday, date] at [time].” Say the full amount, including “hundred” when applicable. Then listen. Skip the service recap and scheduling preamble. On a later turn near the end of a residential quote, ask once about pet urine treatment, rugs, furniture and tile. Skip extras on messages, emergency calls and when declined. Ask about lead source near the end. For a person, take a message; only confirmed active flooding can go to the emergency keypad. Say goodbye aloud before delegating a hangup.`
  const opening = caller
    ? `Greet the caller now in English: “Harry here—is this ${caller.firstName}?” Then listen. This is a caller-ID name confirmation, not proof of identity. If yes, remember that ${caller.firstName} is confirmed. If no, ask who is calling and do not use ${caller.firstName}'s saved details. If the caller has already begun speaking, listen and answer their request instead. Do not repeat the opening.`
    : 'Greet the caller now in English: “Harry here. Want to leave a message, or can I help with something?” Then listen. If the caller has already begun speaking, listen and answer their request instead. Do not repeat the opening.'
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
            text: opening,
          },
        ],
      },
    ],
    delegation: {
      type: 'responses',
      responses: {
        model: 'gpt-6-luna',
        instructions:
          dispatcherInstructions(catalog, coaching, pilot) +
          `\nYou handle delegated business work. Return the verified fact, missing detail, or ${pilot ? 'simulated result' : 'tool-confirmed result'} concisely to Harry. Never guess or treat an interrupted request as current.`,
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
