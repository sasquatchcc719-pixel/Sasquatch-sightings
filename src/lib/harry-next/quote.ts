/**
 * Harry (next) — service menu + quoting.
 *
 * The durable fix for brittle catalog matching. Instead of code trying to guess
 * which catalog item a free-text phrase meant (the old regex matcher), we present
 * the model a NUMBERED menu of the real catalog and it picks by number. This file
 * builds that menu and resolves the model's numbered picks back to real catalog
 * rows — validating every index. The model does the language understanding; code
 * owns the ids, the prices, and the math. The model cannot invent a service, send
 * a fake id, or collapse several services onto one, because it's choosing from the
 * real list and every pick is checked.
 */

export type CatalogItem = {
  id: string
  name: string
  slug: string | null
  basePrice: number | null
  pricingUnit: string
}

/** What the model returns: a 1-based menu number + a quantity. No ids, no prices. */
export type ServiceSelection = { item: number; quantity: number }

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
  invalidItems: number[]
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * A stable, numbered menu of the active catalog for the model to choose from.
 * The names already carry the sqft tiers (e.g. "Sasquatch Size Room (200 to 400
 * Sqft)"), so the model can size a room by the footage the customer gives.
 */
export function buildCatalogMenu(catalog: CatalogItem[]): string {
  return catalog
    .map((item, index) => {
      const unit =
        item.pricingUnit && item.pricingUnit !== 'fixed'
          ? ` (per ${item.pricingUnit.replace(/_/g, ' ').replace(/^per /, '')})`
          : ''
      const price = item.basePrice != null ? ` — $${item.basePrice}${unit}` : ''
      return `${index + 1}. ${item.name}${price}`
    })
    .join('\n')
}

/**
 * Resolve the model's numbered picks into real catalog lines + a real total.
 * Any out-of-range number lands in invalidItems so the flow asks for clarification
 * rather than guessing or dropping it silently.
 */
export function quoteFromSelections(
  catalog: CatalogItem[],
  selections: ServiceSelection[],
): Quote {
  const lines: QuoteLine[] = []
  const invalidItems: number[] = []

  for (const sel of selections) {
    const item = sel.item >= 1 ? catalog[sel.item - 1] : undefined
    if (!item) {
      invalidItems.push(sel.item)
      continue
    }
    const quantity = Math.max(1, Math.floor(sel.quantity) || 1)
    const unitPrice = Number(item.basePrice || 0)
    lines.push({
      serviceCatalogItemId: item.id,
      nameSnapshot: item.name,
      quantity,
      unitPrice,
      lineTotal: round2(unitPrice * quantity),
    })
  }

  const total = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0))
  return { lines, total, invalidItems }
}
