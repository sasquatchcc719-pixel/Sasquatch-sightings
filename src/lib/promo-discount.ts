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
