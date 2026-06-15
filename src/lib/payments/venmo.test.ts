import { describe, expect, it } from 'vitest'
import { buildVenmoPaymentLink } from './venmo'

describe('buildVenmoPaymentLink', () => {
  it('prefills the amount and human invoice number', () => {
    const link = buildVenmoPaymentLink({
      username: 'SasquatchCarpet',
      invoiceNumber: 18209,
      amount: 675,
      customerName: 'Tamara Jarka',
    })
    const url = new URL(link)

    expect(url.searchParams.get('amount')).toBe('675.00')
    expect(url.searchParams.get('note')).toBe(
      'Sasquatch Invoice #18209 - Tamara Jarka',
    )
  })
})
