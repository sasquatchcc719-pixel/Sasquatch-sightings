export const NEXTDOOR_CODE = 'NEXTDOOR35'
export const NEXTDOOR_MINIMUM = 300
export const NEXTDOOR_DISCOUNT = 35
export const isNextdoorCode = (code: unknown) =>
  String(code || '')
    .trim()
    .toUpperCase() === NEXTDOOR_CODE

export type PromoServiceLine = {
  name_snapshot: string
  category?: string
  slug?: string
  unit_price: number
  quantity: number
}
export function nextdoorServiceSubtotal(lines: PromoServiceLine[]) {
  return lines
    .filter(
      (l) =>
        !/^(travel|fees?|tax)$/i.test(l.category || '') &&
        !/^(mileage-travel|travel-fee|tax|fee)$/i.test(l.slug || '') &&
        !/^(mileage[ /-]*travel|travel fee|tax|fees?|google lsa.*)$/i.test(
          l.name_snapshot,
        ),
    )
    .reduce((sum, l) => sum + Number(l.unit_price) * Number(l.quantity), 0)
}
export function nextdoorDiscount(serviceSubtotal: number) {
  return Number.isFinite(serviceSubtotal) &&
    Math.round(serviceSubtotal * 100) >= 30000
    ? NEXTDOOR_DISCOUNT
    : 0
}
/** The review explicitly displays the winning discount; never silently discard a better rug offer. */
export function chooseNextdoorDiscount(promo: number, rug: number) {
  return rug > promo ? { promo: 0, rug } : { promo, rug: 0 }
}
