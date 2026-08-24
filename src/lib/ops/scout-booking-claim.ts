/**
 * Scout booking-claim detection — the honesty gate.
 *
 * Scout's system prompt forbids telling a customer they're booked unless
 * book_new_job actually returned success. A prompt is not an enforcement
 * mechanism: on 2026-08-23 gpt-4o told a customer "You're booked! Confirmation
 * #ABCD1234" — copying the example straight out of its own system prompt —
 * after book_new_job had returned an error. The customer believed she had a
 * 3:00 PM appointment that did not exist, and nobody found out until she was
 * chased down by hand.
 *
 * So the server checks the outgoing reply against the actual tool results. This
 * module is that check, kept separate from the route so it can be tested
 * directly — a false positive replaces a perfectly good message with a scary
 * correction, so the negator handling matters as much as the matching.
 */

export const BOOKING_TOOLS = ['book_new_job', 'book_commercial_estimate']

/** Phrases that assert to the customer that an appointment now exists. */
const BOOKING_CLAIM_PATTERNS: RegExp[] = [
  /\byou(?:'re|re| are)\s+booked\b/i,
  /\byou(?:'re|re| are)\s+all\s+set\b/i,
  /\byou(?:'re|re| are)\s+(?:scheduled|confirmed)\b/i,
  /\bconfirmation\s*(?:#|number|no\b)/i,
  /\bi(?:'ve| have)\s+(?:got\s+you\s+)?(?:booked|scheduled)\b/i,
  /\byou(?:'re|re| are)\s+on\s+(?:the|our)\s+(?:calendar|schedule|books)\b/i,
  /\b(?:appointment|booking|job|cleaning)\s+is\s+(?:now\s+)?(?:booked|confirmed|scheduled)\b/i,
  /\b(?:booked|scheduled)\s+you\s+(?:in|for)\b/i,
]

/**
 * Words that turn a claim into a condition, question or offer — "once you're
 * booked", "before you're all set", "would you like a confirmation number".
 * Without this the gate fires on honest mid-conversation sentences.
 */
const CLAIM_NEGATORS =
  /\b(once|when|whenever|after|before|until|unless|if|so that|in order to|ready to|want to|wanted to|like to|need to|able to|will be|would be|to get|as soon as|then)\s*$/i

export function claimsBooking(text: string): boolean {
  if (!text) return false
  return BOOKING_CLAIM_PATTERNS.some((pattern) => {
    const global = new RegExp(pattern.source, pattern.flags + 'g')
    for (const match of text.matchAll(global)) {
      const index = match.index ?? 0
      const preceding = text.slice(Math.max(0, index - 40), index)
      if (!CLAIM_NEGATORS.test(preceding)) return true
    }
    return false
  })
}

export const BOOKING_NOT_COMPLETED_REPLY =
  "I have to correct myself — I wasn't able to finish that booking, so you are NOT on the schedule yet. I'm sorry for the confusion. I've alerted Charles with your details and he'll reach out shortly to get your time locked in. If you'd rather not wait, call or text us at (719) 249-8791."
