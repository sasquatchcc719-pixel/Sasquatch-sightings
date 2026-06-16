/**
 * Harry (next) — intent schemas.
 *
 * The model's ONLY job is to read the customer's text and emit one of these
 * typed intents. It never calls a mutation tool, never handles an ID/token,
 * never states a price, and never picks a recipient. Deterministic code takes
 * the intent from here and does the real work (see service-edit.ts and the
 * resolver/executor layers).
 *
 * Everything here is validated with zod so a malformed model output is rejected
 * before it can reach any business logic.
 */
import { z } from 'zod'

/**
 * Remove an existing service from a job.
 *
 * `match` is a short phrase taken from the customer's own words ("the closet",
 * "dryer duct"). The model does NOT resolve which line item that is — code does,
 * and only acts on a single unambiguous match. If zero or several lines match,
 * the change becomes a clarification question, never a guess. This is the
 * deliberate opposite of old Harry, where the model fuzzy-matched and collapsed
 * five services onto one.
 */
export const removeServiceIntent = z.object({
  type: z.literal('remove_service'),
  match: z.string().min(1),
})

export type RemoveServiceIntent = z.infer<typeof removeServiceIntent>

/**
 * Slice 1 covers service edits. Additional intents (add_service, set_quantity,
 * reschedule, add_note, book) get added here one at a time, each behind the
 * same approval gate and its own replay tests.
 */
export const serviceEditIntent = z.discriminatedUnion('type', [
  removeServiceIntent,
])

export type ServiceEditIntent = z.infer<typeof serviceEditIntent>
