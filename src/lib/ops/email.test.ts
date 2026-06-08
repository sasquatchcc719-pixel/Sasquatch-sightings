import { describe, expect, it } from 'vitest'
import { isDeliverableCustomerEmail } from './email'
import { nextDripSchedule } from './drip-campaign'

describe('isDeliverableCustomerEmail', () => {
  it('accepts normal customer email addresses', () => {
    expect(isDeliverableCustomerEmail('customer@example.com')).toBe(true)
  })

  it('rejects missing and malformed addresses', () => {
    expect(isDeliverableCustomerEmail(null)).toBe(false)
    expect(isDeliverableCustomerEmail('not-an-email')).toBe(false)
  })

  it('rejects HCP import placeholders', () => {
    expect(isDeliverableCustomerEmail('customer.hcp@import.local')).toBe(false)
  })
})

describe('nextDripSchedule', () => {
  const templates = [
    { step_index: 0, delay_days: 5, is_enabled: true },
    { step_index: 1, delay_days: 30, is_enabled: true },
    { step_index: 2, delay_days: 180, is_enabled: true },
    { step_index: 3, delay_days: 365, is_enabled: true },
  ]

  it('anchors every step to the completion date', () => {
    expect(
      nextDripSchedule({
        templates,
        completionDate: '2026-06-01',
        asOfDate: '2026-06-02',
      }),
    ).toEqual({ step: 0, sendDate: '2026-06-06' })

    expect(
      nextDripSchedule({
        templates,
        completionDate: '2026-06-01',
        asOfDate: '2026-06-06',
        afterStep: 0,
      }),
    ).toEqual({ step: 1, sendDate: '2026-07-01' })
  })

  it('skips intervals that have already passed', () => {
    expect(
      nextDripSchedule({
        templates,
        completionDate: '2026-04-20',
        asOfDate: '2026-06-08',
      }),
    ).toEqual({ step: 2, sendDate: '2026-10-17' })
  })

  it('returns null after the final interval', () => {
    expect(
      nextDripSchedule({
        templates,
        completionDate: '2025-01-01',
        asOfDate: '2026-06-08',
      }),
    ).toBeNull()
  })
})
