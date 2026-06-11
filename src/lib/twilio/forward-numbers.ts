/**
 * Builds the <Number> TwiML elements for forwarding an inbound call to the
 * owner's phones. Multiple <Number> nouns inside one <Dial> ring
 * simultaneously and connect the first to answer — so primary + secondary
 * rings both phones at once. Empty/invalid numbers are dropped and exact
 * duplicates deduped (the failover often equals the primary).
 */

export function buildForwardNumberElements(config: {
  primaryForwardNumber?: string | null
  secondaryForwardNumber?: string | null
}): string {
  const seen = new Set<string>()
  return [config.primaryForwardNumber, config.secondaryForwardNumber]
    .map((n) => String(n || '').trim())
    .filter((n) => n.startsWith('+') && n.length >= 8)
    .filter((n) => {
      if (seen.has(n)) return false
      seen.add(n)
      return true
    })
    .map((n) => `<Number>${n}</Number>`)
    .join('\n    ')
}
