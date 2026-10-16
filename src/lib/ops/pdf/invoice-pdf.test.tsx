// @vitest-environment node
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { InvoicePDF, type InvoicePDFData } from './invoice-pdf'

const invoice: InvoicePDFData = {
  invoiceId: '11111111-1111-4111-8111-111111abcdef',
  invoiceNumber: 18942,
  dueDate: '2026-11-29',
  isPaid: false,
  customerName: 'Example Commercial Customer',
  serviceAddress: '100 Example Street, Colorado Springs, CO 80920',
  serviceDate: '2026-10-15',
  lineItems: [
    {
      description: 'Carpet cleaning',
      quantity: 1,
      unit_price: 1049.94,
      line_total: 1049.94,
    },
  ],
  discountAmount: 0,
  subtotal: 1049.94,
  total: 1049.94,
}

function textOf(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return textOf(node.props.children)
  }
  return ''
}

describe('InvoicePDF remittance', () => {
  it('renders an unpaid invoice with check mailing instructions and its actual number', async () => {
    const document = InvoicePDF({ data: invoice })
    const text = textOf(document)
    const pdf = Buffer.from(await renderToBuffer(document))

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    expect(text).toContain('Pay by check')
    expect(text).toContain('Make checks payable to Sasquatch Carpet Cleaning.')
    expect(text).toContain('PO Box 1651')
    expect(text).toContain('Palmer Lake, CO 80133')
    expect(text).toContain('Include Invoice #18942 on the memo line.')
    expect(text).toContain('Payment due: 2026-11-29')
    expect(text).toContain('Total Due$1049.94')
    expect(text).not.toContain('INV-ABCDEF')
    expect(text).not.toContain('Pay Online')
  })

  it('keeps the mailing address on paid receipts without asking for payment', async () => {
    const document = InvoicePDF({
      data: {
        ...invoice,
        isPaid: true,
        paymentMethod: 'check',
        venmoUrl: 'https://venmo.com/example',
      },
    })
    const text = textOf(document)
    const pdf = Buffer.from(await renderToBuffer(document))

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    expect(text).toContain('RECEIPT')
    expect(text).toContain('PO Box 1651')
    expect(text).toContain('Palmer Lake, CO 80133')
    expect(text).toContain('Payment Confirmed')
    expect(text).toContain('Check')
    expect(text).toContain('Total Paid$1049.94')
    expect(text).not.toContain('Pay by check')
    expect(text).not.toContain('memo line')
    expect(text).not.toContain('Payment due:')
    expect(text).not.toContain('Pay Online')
    expect(text).not.toContain('https://venmo.com/example')
  })

  it('uses the fallback reference in check instructions when no invoice number exists', () => {
    const text = textOf(
      InvoicePDF({ data: { ...invoice, invoiceNumber: null, dueDate: null } }),
    )

    expect(text).toContain('Include INV-ABCDEF on the memo line.')
    expect(text).not.toContain('Payment due:')
  })

  it('preserves the optional online payment choice on unpaid invoices', () => {
    const text = textOf(
      InvoicePDF({
        data: { ...invoice, venmoUrl: 'https://venmo.com/example' },
      }),
    )

    expect(text).toContain('Pay by check')
    expect(text).toContain('Pay Onlinehttps://venmo.com/example')
  })
})
