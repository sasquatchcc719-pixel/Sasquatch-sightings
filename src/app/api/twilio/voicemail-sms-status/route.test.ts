import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  like: vi.fn(),
}))
vi.mock('@/lib/twilio/inbound-auth', () => ({
  validateTwilioInboundRequest: mocks.auth,
}))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({ update: mocks.update }),
  }),
}))

import { POST } from './route'

function request(status = 'delivered') {
  return new NextRequest(
    'https://sightings.sasquatchcarpet.com/api/twilio/voicemail-sms-status',
    {
      method: 'POST',
      body: new URLSearchParams({
        MessageSid: `SM${'1'.repeat(32)}`,
        MessageStatus: status,
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  )
}

describe('voicemail SMS delivery callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockReturnValue(true)
    mocks.update.mockReturnValue({ eq: mocks.eq })
    mocks.eq.mockReturnValue({ like: mocks.like })
    mocks.like.mockResolvedValue({ error: null })
  })

  it('updates only the matching Harry voicemail message', async () => {
    expect((await POST(request())).status).toBe(204)
    expect(mocks.update).toHaveBeenCalledWith({ status: 'delivered' })
    expect(mocks.eq).toHaveBeenCalledWith('twilio_sid', `SM${'1'.repeat(32)}`)
    expect(mocks.like).toHaveBeenCalledWith(
      'message_type',
      'voicemail_harry_reply:%',
    )
  })

  it('rejects forged or invalid callbacks', async () => {
    mocks.auth.mockReturnValue(false)
    expect((await POST(request())).status).toBe(403)
    mocks.auth.mockReturnValue(true)
    expect((await POST(request('unknown'))).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
