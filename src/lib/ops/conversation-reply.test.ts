// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { sendConversationReply } from './conversation-reply'

class Query implements PromiseLike<{ data: unknown; error: null }> {
  private operation: 'select' | 'update' = 'select'
  private updateValue: unknown

  constructor(
    private readonly table: string,
    private readonly state: {
      updates: Array<{ table: string; value: unknown }>
    },
  ) {}

  select() {
    return this
  }
  eq() {
    return this
  }
  in() {
    return this
  }
  update(value: unknown) {
    this.operation = 'update'
    this.updateValue = value
    this.state.updates.push({ table: this.table, value })
    return this
  }
  maybeSingle() {
    if (this.table === 'conversations') {
      return Promise.resolve({
        data: {
          id: '10000000-0000-4000-8000-000000000001',
          phone_number: '+17195550123',
          lead_id: null,
          ops_customer_id: '20000000-0000-4000-8000-000000000001',
          messages: [
            {
              role: 'user',
              content: 'Can you send that photo?',
              timestamp: '2026-10-12T20:00:00Z',
            },
          ],
          status: 'completed',
        },
        error: null,
      })
    }
    if (this.table === 'telegram_relay_threads') {
      return Promise.resolve({
        data: {
          business_number: '+17192498791',
          group_chat_id: -1001234567890,
          topic_id: 321,
        },
        error: null,
      })
    }
    return Promise.resolve({ data: null, error: null })
  }
  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: unknown
          error: null
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    const value =
      this.operation === 'update'
        ? { data: this.updateValue, error: null }
        : this.table === 'ops_customer_media'
          ? {
              data: [
                {
                  id: '30000000-0000-4000-8000-000000000001',
                  conversation_id: '10000000-0000-4000-8000-000000000001',
                  storage_path: 'inbound/customer/photo.jpg',
                  content_type: 'image/jpeg',
                  category: 'customer_file',
                  status: 'available',
                },
              ],
              error: null,
            }
          : { data: null, error: null }
    return Promise.resolve(value).then(onfulfilled, onrejected)
  }
}

describe('sendConversationReply', () => {
  it('uses the retained inbound business number and authorized media', async () => {
    const state = { updates: [] as Array<{ table: string; value: unknown }> }
    const sendSms = vi.fn().mockResolvedValue({
      sid: 'SM123',
      to: '+17195550123',
      from: '+17192498791',
    })
    const postToTelegram = vi.fn().mockResolvedValue(true)
    const supabase = {
      from(table: string) {
        return new Query(table, state)
      },
      storage: {
        from() {
          return {
            createSignedUrl: vi.fn().mockResolvedValue({
              data: { signedUrl: 'https://storage.test/signed-photo' },
              error: null,
            }),
          }
        },
      },
    }

    const result = await sendConversationReply({
      supabase: supabase as never,
      conversationId: '10000000-0000-4000-8000-000000000001',
      message: 'Here is the photo.',
      sentBy: 'Charles',
      mediaIds: ['30000000-0000-4000-8000-000000000001'],
      sendSms,
      postToTelegram,
    })

    expect(sendSms).toHaveBeenCalledWith(
      '+17195550123',
      'Here is the photo.',
      undefined,
      'admin_mms_reply',
      '+17192498791',
      {
        customerId: '20000000-0000-4000-8000-000000000001',
        sentBy: 'Charles',
      },
      ['https://storage.test/signed-photo'],
    )
    expect(result).toMatchObject({
      twilio_sid: 'SM123',
      from: '+17192498791',
      media_count: 1,
    })
    expect(state.updates).toHaveLength(1)
    expect(postToTelegram).not.toHaveBeenCalled()
    expect(state.updates[0].value).toMatchObject({
      status: 'active',
      messages: [
        expect.any(Object),
        expect.objectContaining({
          content: 'Here is the photo.',
          twilio_sid: 'SM123',
          sent_by: 'Charles',
        }),
      ],
    })
  })

  it('mirrors a successful MCP reply once in the existing topic as Harry', async () => {
    const state = { updates: [] as Array<{ table: string; value: unknown }> }
    const sendSms = vi.fn().mockResolvedValue({
      sid: 'SM456',
      to: '+17195550123',
      from: '+17192498791',
    })
    const postToTelegram = vi.fn().mockImplementation(async () => {
      expect(state.updates).toHaveLength(1)
      return true
    })
    const supabase = {
      from(table: string) {
        return new Query(table, state)
      },
      storage: { from: vi.fn() },
    }

    const result = await sendConversationReply({
      supabase: supabase as never,
      conversationId: '10000000-0000-4000-8000-000000000001',
      message: 'We can be there Tuesday.',
      sentBy: 'Charles',
      telegramMirrorLabel: 'Harry',
      sendSms,
      postToTelegram,
    })

    expect(sendSms).toHaveBeenCalledTimes(1)
    expect(postToTelegram).toHaveBeenCalledTimes(1)
    expect(postToTelegram).toHaveBeenCalledWith(
      -1001234567890,
      321,
      'Harry:\nWe can be there Tuesday.',
    )
    expect(result).toMatchObject({
      twilio_sid: 'SM456',
      history_recorded: true,
      telegram_mirrored: true,
      telegram_warning: null,
    })
  })

  it('does not retry the customer SMS when the Telegram mirror fails', async () => {
    const state = { updates: [] as Array<{ table: string; value: unknown }> }
    const sendSms = vi.fn().mockResolvedValue({
      sid: 'SM789',
      to: '+17195550123',
      from: '+17192498791',
    })
    const postToTelegram = vi
      .fn()
      .mockRejectedValue(new Error('Telegram unavailable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = {
      from(table: string) {
        return new Query(table, state)
      },
      storage: { from: vi.fn() },
    }

    const result = await sendConversationReply({
      supabase: supabase as never,
      conversationId: '10000000-0000-4000-8000-000000000001',
      message: 'We can be there Tuesday.',
      sentBy: 'Charles',
      telegramMirrorLabel: 'Harry',
      sendSms,
      postToTelegram,
    })

    expect(sendSms).toHaveBeenCalledTimes(1)
    expect(postToTelegram).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      twilio_sid: 'SM789',
      history_recorded: true,
      telegram_mirrored: false,
    })
    expect(result.telegram_warning).toContain('Telegram mirror failed')
    expect(consoleError).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it('does not mirror when Twilio rejects the customer SMS', async () => {
    const state = { updates: [] as Array<{ table: string; value: unknown }> }
    const sendSms = vi.fn().mockRejectedValue(new Error('Twilio unavailable'))
    const postToTelegram = vi.fn().mockResolvedValue(true)
    const supabase = {
      from(table: string) {
        return new Query(table, state)
      },
      storage: { from: vi.fn() },
    }

    await expect(
      sendConversationReply({
        supabase: supabase as never,
        conversationId: '10000000-0000-4000-8000-000000000001',
        message: 'We can be there Tuesday.',
        sentBy: 'Charles',
        telegramMirrorLabel: 'Harry',
        sendSms,
        postToTelegram,
      }),
    ).rejects.toThrow('Twilio unavailable')

    expect(sendSms).toHaveBeenCalledTimes(1)
    expect(postToTelegram).not.toHaveBeenCalled()
    expect(state.updates).toHaveLength(0)
  })
})
