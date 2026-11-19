// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { countUnreadInboundMessages } from './conversations-unread'

describe('conversation unread projection', () => {
  it('never labels an empty race-created shell as an unread message', () => {
    expect(
      countUnreadInboundMessages({ messages: [], admin_read_at: null }),
    ).toBe(0)
  })

  it('counts the later provider inbound only after it is persisted', () => {
    expect(
      countUnreadInboundMessages({
        messages: [
          { role: 'assistant', timestamp: '2026-11-19T01:00:00Z' },
          { role: 'user', timestamp: '2026-11-19T01:01:00Z' },
        ],
        admin_read_at: null,
      }),
    ).toBe(1)
  })
})
