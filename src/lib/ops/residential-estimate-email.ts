import { isAreaUnit, isLinearUnit } from './estimates'

export type ResidentialEstimateLine = {
  name: string
  quantity: number
  unit_price: number
  line_total: number
  pricing_unit: string | null
}

export function buildResidentialEstimateEmail(params: {
  firstName?: string
  address?: string
  lineItems: ResidentialEstimateLine[]
  subtotal: number
  discountAmount: number
  promoCode?: string | null
  total: number
}): { subject: string; body_text: string } {
  const money = (amount: number) => `$${amount.toFixed(2)}`
  const lines = params.lineItems.map((item) => {
    const quantity = isAreaUnit(item.pricing_unit)
      ? `${item.quantity} sq ft`
      : isLinearUnit(item.pricing_unit)
        ? `${item.quantity} linear ft`
        : String(item.quantity)
    return `- ${item.name}: ${quantity} × ${money(item.unit_price)} = ${money(item.line_total)}`
  })
  const totals = [`Subtotal: ${money(params.subtotal)}`]
  if (params.discountAmount > 0) {
    totals.push(
      `Discount${params.promoCode ? ` (${params.promoCode})` : ''}: −${money(params.discountAmount)}`,
    )
  }
  totals.push(`Estimated total: ${money(params.total)}`)

  return {
    subject: 'Your Estimate from Sasquatch Carpet Cleaning',
    body_text: [
      params.firstName ? `Hi ${params.firstName},` : 'Hello,',
      'Thank you for considering Sasquatch Carpet Cleaning. Here is your estimate for the services listed below.',
      ...(params.address ? [`Service address: ${params.address}`] : []),
      lines.join('\n'),
      totals.join('\n'),
      'This estimate is based on the services and quantities listed. If the scope changes, we will review any price adjustment with you before work begins.',
      'When you are ready to book, call or text us at (719) 249-8791. We will help you choose an available appointment. This estimate does not reserve a date or time.',
      'Thank you,\nThe Sasquatch Carpet Cleaning Team\n(719) 249-8791',
    ].join('\n\n'),
  }
}
