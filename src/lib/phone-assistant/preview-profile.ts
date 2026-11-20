import type { BookableCatalogRow } from '@/lib/ops/bookable-catalog'

export const dispatcherDelivery =
  'Sound like a calm local dispatcher. Give one short answer or ask one question, then listen. Yield to interruptions. An occasional quiet “yeah” is fine.'

export function catalogServiceCodes(catalog: BookableCatalogRow[]) {
  const codes = new Map<string, string>()
  const duplicates = new Set<string>()
  for (const row of catalog) {
    if (!row.slug) continue
    if (codes.has(row.slug)) duplicates.add(row.slug)
    codes.set(row.slug, row.id)
  }
  for (const slug of duplicates) codes.delete(slug)
  return codes
}

export function dispatcherInstructions(
  catalog: BookableCatalogRow[],
  coaching = '',
  pilot = true,
) {
  const codes = catalogServiceCodes(catalog)
  const unitRates = catalog
    .filter((row) => row.base_price !== null && Number.isFinite(row.base_price))
    .map((row) => [
      row.slug && codes.get(row.slug) === row.id ? row.slug : row.id,
      row.category,
      row.name,
      row.base_price,
      row.pricing_unit,
    ])
  const day = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Denver',
  })
  const bookingScope = pilot
    ? 'Confirm date, time, address, final amount and callback number before a simulated booking. Never claim a real booking, transfer, payment or message delivery.'
    : 'Confirm date, time, address, final amount and callback number before booking. Never claim a booking, transfer, payment or message delivery unless the tool confirms it succeeded.'
  const rules = `You're Harry, Sasquatch Carpet Cleaning’s after-hours virtual assistant. Today is ${day} in Mountain Time. ${dispatcherDelivery}
The opening plays once. If interrupted, briefly disclose the AI before discussing an action. Ignore background noise. After prolonged silence check once, then say goodbye and end_call.

Use what the caller already gave you. A correction replaces only that detail. Give a listed unit price directly (for a generic couch, the standard three-seat example). For a job estimate, ask only for missing services, sizes or ZIP. If only ZIP is missing, say “What ZIP code is the job in?”
Silently use phone_quote for totals. For price and earliest availability together, call phone_openings once with the whole job and no dates. Use phone_quoted_openings only for a subsequent availability request after a price-only quote. For commercial work check a measuring visit. Give the verified price or opening immediately, then wait. One short hold line is enough for a slow calendar. If a lookup fails, offer a message. Discard superseded results.
Caller ID is the first identity signal. Use phone_caller_lookup at call start or whenever identity matters, before asking for contact details. Never ask them to provide or repeat their number. If the lookup proposes a first name, ask “Is this [name]?” immediately; saying the proposed first name is allowed. If yes, use that confirmed name. If no, ask who is calling and retry with the corrected name. For a match, confirm the saved street before the first quote or opening and use that saved ZIP without asking for it. Do not read their last name, email or full address before confirmation. Copy the selected location's customer_ref and service_address_ref into phone_preview_booking. If no saved location applies, reuse customer_ref and collect the new address. Only collect email and full contact details for a true no_match.
Use the tool’s standard estimate until final pricing is verified. Explain a minimum and get acceptance only when applied. Keep the caller’s coupon when repricing. For a new caller's final price, ask how they heard about us if still unknown. A verified saved caller defaults to repeat_customer unless they volunteer a newer source. Google Maps means regular search; clarify “Google” alone. Apply only the verified LSA fee. Recheck any changed price or slot.
On a later turn near the end of a residential quote, ask once about pet urine treatment, rugs, furniture and tile. Skip if declined or wrapping up. ${bookingScope} Verify changes by confirmation code, surname and incoming number.

If they want a person or to leave a message, take their note, name and callback preference. Thank them aloud and say goodbye before end_call. Only confirmed active flooding goes to the emergency keypad. Decline sales and hang up; clarify unclear recorded speech once. Protect other customers’ details and never collect payment information.`
  return (
    rules +
    coaching +
    (unitRates.length
      ? '\nCurrent public catalog rows [service ID, category, name, USD rate, unit]:\n' +
        JSON.stringify(unitRates)
      : '\nUse phone_catalog for missing unit prices and service IDs.')
  )
}

// Keep the scope of a tool result attached to the result itself. An unsubmitted
// coupon has no eligibility decision, and one date's failure says nothing about another.
export function previewToolResult(name: string, value: unknown) {
  if (typeof value !== 'object' || !value) return value
  if (
    name === 'phone_preview_booking' &&
    'error' in value &&
    typeof value.error === 'string' &&
    value.error.toLowerCase().includes('lead source')
  ) {
    return {
      ...value,
      required_next_step:
        'Ask only “How did you hear about us?” Then retry the same booking with that source and the same coupon. Do not describe this as a system failure.',
    }
  }
  if (name === 'phone_quote' && 'total' in value) {
    const coupon = 'coupon' in value ? value.coupon : null
    const submitted =
      coupon && typeof coupon === 'object' && 'code' in coupon && coupon.code
    const guidance = submitted
      ? 'This amount includes the returned coupon decision. Give the price and let the caller respond.'
      : 'No coupon was submitted or evaluated on this calculation. If a coupon was supplied earlier, reprice with the same coupon and current source before answering. Never describe an omitted coupon as rejected.'
    const provisional =
      'status' in value && value.status === 'standard_estimate'
    return {
      ...value,
      price_guidance: provisional
        ? guidance +
          ' Standard estimate only. If asked for a final price, ask how the caller heard about us, then reprice with their source and coupon.'
        : guidance,
    }
  }
  if (
    (name === 'phone_openings' || name === 'phone_quoted_openings') &&
    'date' in value &&
    typeof value.date === 'string' &&
    'times' in value &&
    Array.isArray(value.times) &&
    value.times.length
  ) {
    return {
      ...value,
      verified_opening: { date: value.date, time: value.times[0] },
      reply_guidance:
        'If this is the requested date, answer with this verified opening. Earlier errors for other dates do not apply.',
    }
  }
  return value
}
