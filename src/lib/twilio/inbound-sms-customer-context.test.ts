import { describe, expect, it } from 'vitest'
import { renderInboundSmsCustomerContext } from './inbound-sms-customer-context'

describe('inbound SMS customer email context', () => {
  it('labels phone numbers that do not match a customer', () => {
    const html = renderInboundSmsCustomerContext(null)

    expect(html).toContain('No customer record matched this phone number')
  })

  it('does not mislabel database failures as unknown customers', () => {
    const html = renderInboundSmsCustomerContext(undefined)

    expect(html).toContain('Customer lookup unavailable')
    expect(html).not.toContain('No customer record matched')
  })

  it('renders customer details, job history, and safe admin links', () => {
    const html = renderInboundSmsCustomerContext({
      customer: {
        id: 'customer-1',
        name: 'Jane <Customer>',
        businessName: null,
        email: 'jane@example.com',
        phone: '+17195551212',
      },
      address: '123 Main St, Monument, CO 80132',
      jobs: [
        {
          id: 'appointment-1',
          date: '2026-06-15',
          startTime: '09:30:00',
          status: 'confirmed',
          quotedTotal: 325,
          address: '123 Main St, Monument, CO 80132',
          services: ['Carpet cleaning', 'Pet treatment'],
          timing: 'upcoming',
        },
      ],
    })

    expect(html).toContain('Known customer')
    expect(html).toContain('Jane &lt;Customer&gt;')
    expect(html).not.toContain('Jane <Customer>')
    expect(html).toContain('Carpet cleaning, Pet treatment')
    expect(html).toContain('$325.00 quoted')
    expect(html).toContain('/admin/operations/appointments/appointment-1')
  })
})
