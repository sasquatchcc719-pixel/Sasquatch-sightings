/**
 * Returns forward targets in their routing order. Each target must be dialed
 * in a separate TwiML step so the primary phone rings before the secondary.
 * Empty/invalid numbers are dropped and exact duplicates are deduped.
 */

export function getForwardNumbers(config: {
  primaryForwardNumber?: string | null
  secondaryForwardNumber?: string | null
}): string[] {
  const seen = new Set<string>()
  return [config.primaryForwardNumber, config.secondaryForwardNumber]
    .map((n) => String(n || '').trim())
    .filter((n) => n.startsWith('+') && n.length >= 8)
    .filter((n) => {
      if (seen.has(n)) return false
      seen.add(n)
      return true
    })
}
