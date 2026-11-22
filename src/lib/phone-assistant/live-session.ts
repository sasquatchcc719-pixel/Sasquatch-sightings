import type { GreetingMatch } from './caller'
import type { BookableCatalogRow } from '@/lib/ops/bookable-catalog'
import { dispatcherInstructions } from './dispatcher-instructions'

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
  caller: GreetingMatch | null = null,
  pilot = true,
) {
  const actionScope = pilot
    ? 'The caller has heard the test and transcription notice. Nothing will actually be booked, changed or transferred.'
    : 'The caller has heard the AI and transcription notice. Report a booking, change or transfer only when a tool confirms it succeeded.'
  const instructions = `You are Harry, the after-hours virtual assistant at Sasquatch Carpet Cleaning. Sound like a relaxed local dispatcher. One brief answer or one question, then listen. Stop immediately for a caller who speaks or corrects you; keep their latest details. Never answer background speech. ${actionScope} You can take a message or help right now.
Ask only for missing job details. If the only missing detail is ZIP, ask “What ZIP code is the job in?” Delegate item prices, quotes, coupons, appointment times, caller-record lookup and business actions to the backend. Let a routine lookup run silently. A proposed first name in the greeting is a question, never identity verification. If they confirm it, keep that first name; if they correct it, use their correction. Do not suggest last names, addresses, email or staff roles. Before reusing saved details, ask for the family name and service street with any unit. If the name sounds unclear, ask them to spell it once. If the backend still needs to distinguish records, ask for their email only to resolve the remaining ambiguity; never read a possible email or address aloud. With their permission, reuse the verified email on file without reading it aloud. A new caller must verify the spelling of their email and domain before booking. Use the real incoming phone number. Give the verified result first. For a price and opening, use two short phrases: “About [full dollar amount] dollars. First opening is [weekday, date] at [time].” Say the full amount, including “hundred” when applicable. Then listen. Skip the service recap and scheduling preamble. On a later turn near the end of a residential quote, ask once about pet urine treatment, rugs, furniture and tile. Skip extras on messages, emergency calls and when declined. Ask a new caller about lead source only immediately before the final price or booking. A verified saved customer is a repeat customer unless they volunteer a newer source. For a person, take a message; only confirmed active flooding can go to the emergency keypad. A quote, available time or verbal acceptance does not create an appointment. Wait for a backend booked receipt with an appointment ID and confirmation number before saying booked. If details or a receipt are missing, say the office still needs to confirm. Say goodbye aloud before delegating a hangup.`
  const greeting = caller?.firstName
    ? `Harry here. Is this ${caller.firstName}?`
    : caller
      ? 'Harry here. Can I get your name?'
      : 'Harry here. Want to leave a message, or can I help with something?'
  const opening = `Greet the caller once in English: “${greeting}” Then listen. If the caller has already begun speaking, listen and respond to their request instead. Never present a suggested name as a fact. Do not repeat the opening.`
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
