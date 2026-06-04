/**
 * Recipient-safety guards for owner-driven (Telegram) Harry SMS sends.
 *
 * Background: a "Hi Marianne…" message once went to a different customer (Alex)
 * because the send tool resolved the recipient from a vague target ("this
 * customer") via fuzzy text matching. These pure helpers back the guards that
 * make that class of mistake impossible: deictic targets must resolve to a
 * confirmed active thread, and the greeting in the body must match the resolved
 * recipient.
 */

export type RecipientNameFields = {
  first_name?: string | null
  full_name?: string | null
  business_name?: string | null
}

// Phrases that refer to "the current customer" rather than naming a person.
// These must resolve to the thread's confirmed active conversation — never to a
// fuzzy text/name guess.
export const DEICTIC_TARGET_PHRASES = new Set([
  'this customer',
  'the customer',
  'current customer',
  'the current customer',
  'this client',
  'the client',
  'this person',
  'the person',
  'the person texting',
  'this contact',
  'the contact',
  'them',
  'they',
  'him',
  'her',
  'this one',
  'the one',
  'the one youre talking to',
  'the one you are talking to',
  'this conversation',
  'the conversation',
  'current conversation',
  'the current conversation',
  'active thread',
  'this thread',
  'the thread',
  'this number',
  'the number',
  'same person',
  'same customer',
])

export function looksLikeDeicticReference(target: string): boolean {
  const normalized = target
    .toLowerCase()
    .trim()
    .replace(/[.!?,]+$/, '')
  return DEICTIC_TARGET_PHRASES.has(normalized)
}

// Pull the name a message greets, e.g. "Hi Marianne," -> "Marianne". Returns
// null for generic greetings ("Hi there") or when there is no greeting.
export function extractGreetingName(message: string): string | null {
  const match = message.match(
    /^\s*(?:hi|hello|hey|dear|good (?:morning|afternoon|evening))[\s,]+([A-Za-z][A-Za-z'’-]+)/i,
  )
  if (!match) return null
  const name = match[1].trim()
  if (
    /^(there|again|all|everyone|folks|team|customer|friend|y'?all)$/i.test(name)
  ) {
    return null
  }
  return name
}

// True only if the greeting name plausibly belongs to the resolved recipient.
export function recipientNameMatches(
  customer: RecipientNameFields | null,
  label: string,
  greetingName: string,
): boolean {
  const greeting = greetingName.toLowerCase()
  const names = [
    customer?.first_name,
    customer?.full_name,
    customer?.business_name,
    label,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase())

  return names.some((name) => {
    const words = name.split(/\s+/)
    return words.includes(greeting) || name.startsWith(greeting)
  })
}
