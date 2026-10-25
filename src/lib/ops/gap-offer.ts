import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeFillPhone } from './tomorrow-fill-rules'

export type GapOfferTerms = {
  id: string
  customer_id: string
  phone: string
  gap_date: string
  gap_start: string
  gap_end: string
  minimum_service_cents: number
  amount: number
  code: 'TF35'
}
export function calculateGapOffer(input: {
  terms: GapOfferTerms
  service_subtotal: number
  fees?: number
  tax?: number
  existing_discount?: number
  negative_lines?: boolean
}) {
  if (
    ![
      input.service_subtotal,
      input.fees ?? 0,
      input.tax ?? 0,
      input.terms.amount,
    ].every((v) => Number.isFinite(v) && v >= 0) ||
    input.terms.amount !== 35 ||
    input.terms.minimum_service_cents !== 30000
  )
    throw new Error('Invalid TF35 monetary terms')
  if (input.existing_discount || input.negative_lines)
    throw new Error('TF35 cannot combine with another discount or credit')
  const cents = Math.round(input.service_subtotal * 100)
  if (!Number.isFinite(cents) || cents < input.terms.minimum_service_cents)
    throw new Error(
      'TF35 requires service of $300 or more before travel, fees and tax',
    )
  const subtotal =
    Math.round((input.service_subtotal + (input.fees ?? 0)) * 100) / 100
  return {
    service_subtotal: cents / 100,
    subtotal,
    discount_amount: input.terms.amount,
    total:
      Math.round((subtotal - input.terms.amount + (input.tax ?? 0)) * 100) /
      100,
    discount_metadata: {
      promo: { code: 'TF35', amount: input.terms.amount },
      gap_offer: {
        id: input.terms.id,
        minimum_service_cents: input.terms.minimum_service_cents,
        service_subtotal: cents / 100,
        stacking: false,
      },
    },
  }
}
export async function loadGapOffer(
  db: SupabaseClient,
  id: string,
  phone: string,
  date: string,
  start: string,
  end: string,
  allowAlternate = false,
): Promise<GapOfferTerms> {
  const { data, error } = await db
    .from('gap_outreach_recipients')
    .select(
      'id,customer_id,phone,status,appointment_id,batch:gap_outreach_batches(payload)',
    )
    .eq('id', id)
    .single()
  if (error) throw error
  if (
    !data ||
    data.appointment_id ||
    !['accepted', 'delivered', 'replied'].includes(data.status) ||
    normalizeFillPhone(data.phone) !== normalizeFillPhone(phone)
  )
    throw new Error('Approved, unredeemed customer offer required')
  const batch = Array.isArray(data.batch) ? data.batch[0] : data.batch
  const payload = batch?.payload as {
    gap: { date: string; start_time: string; end_time: string }
    offer: { minimum_service_cents: number; amount: number }
  }
  if (!payload) throw new Error('Offer terms missing')
  const inGap =
    date === payload.gap.date &&
    start.slice(0, 5) >= payload.gap.start_time.slice(0, 5) &&
    end.slice(0, 5) <= payload.gap.end_time.slice(0, 5)
  if (!inGap && !allowAlternate)
    throw new Error(
      'Alternate time is welcome; owner must explicitly decide whether TF35 also applies before quoting that discount',
    )
  return {
    id: data.id,
    customer_id: data.customer_id,
    phone: data.phone,
    gap_date: payload.gap.date,
    gap_start: payload.gap.start_time,
    gap_end: payload.gap.end_time,
    minimum_service_cents: payload.offer.minimum_service_cents,
    amount: payload.offer.amount,
    code: 'TF35',
  }
}

/** Generic saved/email estimates cannot encode TF35 without the linked conversion path. */
export function assertSupportedGapEstimate(
  lines: Array<{
    description?: unknown
    name_snapshot?: unknown
    notes?: unknown
  }>,
  internalNotes: unknown,
  approvedOffer = false,
) {
  const text = [
    internalNotes,
    ...lines.flatMap((line) => [
      line.description,
      line.name_snapshot,
      line.notes,
    ]),
  ]
    .filter((value) => typeof value === 'string')
    .join('\n')
  if (!approvedOffer && /\bTF35\b/i.test(text))
    throw new Error(
      'TF35 must be quoted through an approved booking or estimate-conversion preview; generic saved/emailed estimates cannot carry this offer',
    )
}
