import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  commercialAchTelegramCard,
  isCommercialAchTelegramApprover,
} from './commercial-ach-approval-shared'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('commercial ACH Telegram approval security', () => {
  it('fails closed when the webhook secret or owner identity is missing', () => {
    vi.stubEnv('TELEGRAM_RELAY_SECRET_TOKEN', '')
    vi.stubEnv('CHARLES_TELEGRAM_CHAT_ID', '')
    expect(isCommercialAchTelegramApprover(123)).toBe(false)

    vi.stubEnv('TELEGRAM_RELAY_SECRET_TOKEN', 'configured')
    expect(isCommercialAchTelegramApprover(123)).toBe(false)
  })

  it('accepts only the configured owner Telegram identity', () => {
    vi.stubEnv('TELEGRAM_RELAY_SECRET_TOKEN', 'configured')
    vi.stubEnv('CHARLES_TELEGRAM_CHAT_ID', '123')

    expect(isCommercialAchTelegramApprover(123)).toBe(true)
    expect(isCommercialAchTelegramApprover(456)).toBe(false)
  })

  it('identifies the requester without putting banking details in Telegram', () => {
    const card = commercialAchTelegramCard({
      requestId: '11111111-1111-4111-8111-111111111111',
      businessName: 'Example Business',
      requesterName: 'Jamie Manager',
      requesterEmail: 'manager@example.com',
      requestedAt: new Date('2026-09-29T18:00:00.000Z'),
      customerId: '22222222-2222-4222-8222-222222222222',
    })

    expect(card.message).toContain('Example Business')
    expect(card.message).toContain('Jamie Manager')
    expect(card.message).toContain('manager@example.com')
    expect(card.message).not.toMatch(/routing|account number|beneficiary/i)
    expect(card.buttons).toEqual([
      [
        expect.objectContaining({
          callback_data: 'ach:approve:11111111-1111-4111-8111-111111111111',
        }),
        expect.objectContaining({
          callback_data: 'ach:deny:11111111-1111-4111-8111-111111111111',
        }),
      ],
    ])
  })
})
