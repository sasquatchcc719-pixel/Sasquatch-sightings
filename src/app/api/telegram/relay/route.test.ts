// @vitest-environment node
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rememberRelayGroup: vi.fn(),
  relayTopicReplyToSms: vi.fn(),
}))

vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({}),
}))

vi.mock('@/lib/telegram/relay', () => ({
  handleCustomerMediaCallback: vi.fn().mockResolvedValue(false),
  postToTopic: vi.fn().mockResolvedValue(true),
  registerRelayOperator: vi.fn(),
  rememberRelayGroup: mocks.rememberRelayGroup,
  relayTopicReplyToSms: mocks.relayTopicReplyToSms,
}))

vi.mock('@/lib/ops/tomorrow-fill', () => ({
  handleTomorrowFillTelegramCallback: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/lib/ops/commercial-ach-approval', () => ({
  handleCommercialAchTelegramCallback: vi.fn().mockResolvedValue(false),
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('TELEGRAM_RELAY_SECRET_TOKEN', 'test-relay-secret')
})
afterEach(() => vi.unstubAllEnvs())

describe('Telegram relay webhook', () => {
  it.each([false, true])(
    'rejects missing configuration or credentials: %s',
    async (configured) => {
      if (!configured) vi.stubEnv('TELEGRAM_RELAY_SECRET_TOKEN', '')
      const response = await POST(
        new NextRequest('https://example.test/api/telegram/relay', {
          method: 'POST',
          body: 'not json',
        }),
      )
      expect(response.status).toBe(401)
      expect(mocks.rememberRelayGroup).not.toHaveBeenCalled()
      expect(mocks.relayTopicReplyToSms).not.toHaveBeenCalled()
    },
  )
  it('ignores the bot-authored outbound mirror so it cannot become another SMS', async () => {
    const request = new NextRequest(
      'https://sightings.sasquatchcarpet.com/api/telegram/relay',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-relay-secret',
        },
        body: JSON.stringify({
          update_id: 1,
          message: {
            message_id: 2,
            from: { id: 3, is_bot: true, first_name: 'Sasquatch Bot' },
            chat: {
              id: -1001234567890,
              title: 'Customers',
              type: 'supergroup',
            },
            text: 'Harry:\nWe can be there Tuesday.',
            message_thread_id: 321,
            is_topic_message: true,
          },
        }),
      },
    )

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mocks.relayTopicReplyToSms).not.toHaveBeenCalled()
  })
})
