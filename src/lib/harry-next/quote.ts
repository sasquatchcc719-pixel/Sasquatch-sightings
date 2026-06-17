/**
 * Harry (next) — build a quote from plain-words services.
 *
 * Takes the services a customer described (already segmented into descriptor +
 * quantity by the model) and turns them into real line items + a real total,
 * using the deterministic catalog matcher. Code owns every number; the model
 * never sees a price or an ID. Descriptors that can't be matched confidently are
 * returned in `unmatched`/`ambiguous` so the flow asks instead of guessing.
 */
import { matchServiceDescription, type CatalogItem } from './match-service'

export type RequestedService = { description: string; quantity: number }

export type QuoteLine = {
  serviceCatalogItemId: string
  nameSnapshot: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export type Quote = {
  lines: QuoteLine[]
  total: number
  unmatched: string[]
  ambiguous: string[]
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function buildQuote(
  catalog: CatalogItem[],
  requested: RequestedService[],
): Quote {
  const lines: QuoteLine[] = []
  const unmatched: string[] = []
  const ambiguous: string[] = []

  for (const req of requested) {
    const match = matchServiceDescription(
      catalog,
      req.description,
      req.quantity,
    )
    if (match.status === 'matched') {
      const unitPrice = Number(match.item.basePrice || 0)
      lines.push({
        serviceCatalogItemId: match.item.id,
        nameSnapshot: match.item.name,
        quantity: match.quantity,
        unitPrice,
        lineTotal: round2(unitPrice * match.quantity),
      })
    } else if (match.status === 'ambiguous') {
      ambiguous.push(req.description)
    } else {
      unmatched.push(req.description)
    }
  }

  const total = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0))
  return { lines, total, unmatched, ambiguous }
}
