// @vitest-environment node
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

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

describe('Telegram relay webhook', () => {
  it('ignores the bot-authored outbound mirror so it cannot become another SMS', async () => {
    const request = new NextRequest(
      'https://sightings.sasquatchcarpet.com/api/telegram/relay',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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
