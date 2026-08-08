/**
 * Promotional discount math — must match `POST /api/public/appointments`.
 */
export function computePromoDiscountAmount(
  subtotal: number,
  discountType: string,
  rawAmount: number,
): number {
  if (discountType === 'percent') {
    return Math.round(((subtotal * rawAmount) / 100) * 100) / 100
  }
  return rawAmount
}

export type PromoCodeTier = { min_spend: number; discount_amount: number }

/**
 * Spend-based tiered discount (e.g. $25 off $200+, $50 off $500+). Returns
 * the highest tier the subtotal qualifies for, or 0 if none apply.
 */
export function computeTieredDiscountAmount(
  subtotal: number,
  tiers: PromoCodeTier[],
): number {
  let best = 0
  for (const tier of tiers) {
    if (subtotal >= tier.min_spend && tier.discount_amount > best) {
      best = tier.discount_amount
    }
  }
  return best
}
