import { describe, expect, it } from 'vitest'
import { engagementForButton, shouldUpgradeEngagement } from './nfc-engagement'

describe('NFC engagement classification', () => {
  it.each([
    ['booking_widget_submit', 'booking'],
    ['form_submit', 'form'],
    ['text', 'text_chat'],
    ['text_us', 'text_chat'],
    ['text_chat', 'text_chat'],
    ['call', 'call'],
    ['booking_widget_open', 'booking_started'],
    ['booking_page', 'booking_started'],
    ['book_now', 'booking_started'],
  ])('maps %s to %s', (button, engagement) => {
    expect(engagementForButton(button)).toBe(engagement)
  })

  it('does not treat an unrecognized action as engagement', () => {
    expect(engagementForButton('save_contact')).toBeNull()
  })

  it('keeps the strongest recorded engagement', () => {
    expect(shouldUpgradeEngagement(null, 'booking_started')).toBe(true)
    expect(shouldUpgradeEngagement('booking_started', 'text_chat')).toBe(true)
    expect(shouldUpgradeEngagement('booking', 'text_chat')).toBe(false)
    expect(shouldUpgradeEngagement('text_chat', 'text_chat')).toBe(false)
  })
})
