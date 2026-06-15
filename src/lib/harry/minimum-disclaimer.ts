const MINIMUM_DISPATCH_AMOUNT = 150

function parseMoney(value: string): number {
  return Number(value.replace(/,/g, ''))
}

function explicitQuoteTotal(response: string): number | null {
  const totalPatterns = [
    /\b(?:estimated\s+)?total\s*(?:is|:|-)?\s*\$([\d,]+(?:\.\d{1,2})?)/i,
    /\bquote(?:d)?(?:\s+total)?\s*(?:is|:|-)?\s*\$([\d,]+(?:\.\d{1,2})?)/i,
    /=\s*\$([\d,]+(?:\.\d{1,2})?)(?:\s|$)/i,
    /\$([\d,]+(?:\.\d{1,2})?)\s+total\b/i,
  ]

  for (const pattern of totalPatterns) {
    const match = response.match(pattern)
    if (match) return parseMoney(match[1])
  }

  return null
}

function quantifiedUnitSubtotal(response: string): {
  subtotal: number
  matchedPriceCount: number
} {
  const pattern =
    /\b(\d+)\s+[^$\n.!?]{0,80}?\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:each|per\b)/gi
  let subtotal = 0
  let matchedPriceCount = 0

  for (const match of response.matchAll(pattern)) {
    subtotal += Number(match[1]) * parseMoney(match[2])
    matchedPriceCount += 1
  }

  return { subtotal, matchedPriceCount }
}

/**
 * Only force the minimum language when the response contains a verified total.
 * Several unit prices may represent a partial quote, not the full job total.
 */
export function needsMinimumDisclaimer(response: string): boolean {
  const lower = response.toLowerCase()
  if (lower.includes('minimum') || lower.includes('$150')) return false
  if (
    lower.includes('booked') ||
    lower.includes('confirmed') ||
    lower.includes('walkthrough')
  ) {
    return false
  }

  const explicitTotal = explicitQuoteTotal(response)
  if (explicitTotal !== null) {
    return explicitTotal > 0 && explicitTotal < MINIMUM_DISPATCH_AMOUNT
  }

  const priceMatches = response.match(/\$[\d,]+(?:\.\d{1,2})?/g) || []
  if (priceMatches.length === 0) return false

  const quantified = quantifiedUnitSubtotal(response)
  if (quantified.matchedPriceCount > 0) {
    if (quantified.subtotal >= MINIMUM_DISPATCH_AMOUNT) return false
    if (quantified.matchedPriceCount === priceMatches.length) return true

    return false
  }

  if (priceMatches.length !== 1) return false

  const onlyPrice = parseMoney(priceMatches[0].slice(1))
  return onlyPrice > 0 && onlyPrice < MINIMUM_DISPATCH_AMOUNT
}
