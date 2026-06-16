/**
 * Harry (next) — intent reader.
 *
 * Turns one inbound customer text into a validated, typed intent. This is the
 * ONLY place the model runs in slice 1, and its job is deliberately tiny: read
 * the message, name what the customer wants. It is handed service *names* only —
 * never IDs, prices, or quantities — and anything it emits is validated against
 * the zod schema before it can reach business logic. A number the model tries to
 * sneak in is stripped; malformed output is rejected, not guessed at.
 *
 * The model call is injected so this is fully unit-testable without a network.
 */
import { serviceEditIntent, type ServiceEditIntent } from './intents'

export type IntentModel = (prompt: {
  system: string
  user: string
}) => Promise<string>

export type ReadIntentResult =
  | { status: 'intent'; intent: ServiceEditIntent }
  | { status: 'no_action' }
  | { status: 'unparseable'; raw: string }

const SYSTEM = `You read ONE inbound text from a carpet-cleaning customer about an EXISTING booking and decide whether they are asking to remove a service from their job.

Output ONLY JSON, nothing else. Either:
  {"type":"remove_service","match":"<short phrase naming the service to remove, in the customer's words>"}
or, if they are not clearly asking to remove a service:
  {"type":"none"}

Hard rules:
- Never output a price, total, quantity, ID, or any number. You only identify intent.
- "match" is a short phrase naming the service (e.g. "closet", "dryer duct").
- If it is unclear, output {"type":"none"} — a human will follow up. Do not guess.`

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
}

export async function readServiceEditIntent(params: {
  customerMessage: string
  currentServices: string[]
  model: IntentModel
}): Promise<ReadIntentResult> {
  const user = [
    `Current services on the job: ${params.currentServices.join(', ') || '(none listed)'}`,
    `Customer message: ${params.customerMessage}`,
  ].join('\n')

  const raw = await params.model({ system: SYSTEM, user })

  let parsed: unknown
  try {
    parsed = JSON.parse(stripFences(raw))
  } catch {
    return { status: 'unparseable', raw }
  }

  if (
    parsed &&
    typeof parsed === 'object' &&
    (parsed as { type?: unknown }).type === 'none'
  ) {
    return { status: 'no_action' }
  }

  const result = serviceEditIntent.safeParse(parsed)
  if (result.success) {
    return { status: 'intent', intent: result.data }
  }
  return { status: 'unparseable', raw }
}
