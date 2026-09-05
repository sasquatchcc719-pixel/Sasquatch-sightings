import { describe, expect, it } from 'vitest'
import {
  hasBlockingCustomerHistory,
  totalCustomerDeletionCount,
} from './customer-deletion'

describe('customer deletion safety', () => {
  it('allows an empty customer record', () => {
    expect(
      hasBlockingCustomerHistory([
        { key: 'appointments', label: 'Appointments', count: 0 },
        { key: 'agreements', label: 'Agreements', count: 0 },
      ]),
    ).toBe(false)
  })

  it('blocks deletion when any protected history exists', () => {
    expect(
      hasBlockingCustomerHistory([
        { key: 'appointments', label: 'Appointments', count: 0 },
        { key: 'agreements', label: 'Agreements', count: 1 },
      ]),
    ).toBe(true)
  })

  it('totals the records affected by deletion', () => {
    expect(
      totalCustomerDeletionCount([
        { key: 'addresses', label: 'Addresses', count: 2 },
        { key: 'reminders', label: 'Reminders', count: 3 },
      ]),
    ).toBe(5)
  })
})
