import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createAdminClientMock,
  getCallRoutingConfigMock,
  isBlacklistedMock,
  sendOneSignalNotificationMock,
} = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  getCallRoutingConfigMock: vi.fn(),
  isBlacklistedMock: vi.fn(),
  sendOneSignalNotificationMock: vi.fn(),
}))

vi.mock('@/lib/twilio/call-routing-config', () => ({
  getCallRoutingConfig: getCallRoutingConfigMock,
}))

vi.mock('@/lib/onesignal', () => ({
  sendOneSignalNotification: sendOneSignalNotificationMock,
}))

vi.mock('@/lib/blacklist', () => ({
  isBlacklisted: isBlacklistedMock,
  notifyBlockedAttempt: vi.fn(),
}))

vi.mock('@/supabase/server', () => ({
  createAdminClient: createAdminClientMock,
}))

import { POST } from './route'

const routingConfig = {
  temporaryOpenLineMode: true,
  businessHoursStart: 9,
  businessHoursEnd: 17,
  businessDays: ['Monday'],
  primaryForwardNumber: '+17206447577',
  secondaryForwardNumber: '+17197498807',
  failoverForwardNumber: '+17206447577',
  openLineTimeoutSeconds: 30,
  ivrScheduleTimeoutSeconds: 45,
  ivrTechnicalTimeoutSeconds: 20,
}

function twilioRequest(): NextRequest {
  const body = new URLSearchParams()
  body.set('CallSid', 'CA123')
  body.set('From', '+17195550123')

  return new NextRequest(
    'https://sightings.sasquatchcarpet.com/api/twilio/call-router',
    {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  )
}

describe('POST /api/twilio/call-router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCallRoutingConfigMock.mockResolvedValue(routingConfig)
    isBlacklistedMock.mockResolvedValue(false)
    sendOneSignalNotificationMock.mockResolvedValue(undefined)
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => ({ upsert: vi.fn(() => Promise.resolve()) })),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('dials the primary phone before the open-line failover', async () => {
    const response = await POST(twilioRequest())
    const twiml = await response.text()

    expect(twiml).toContain('<Number>+17206447577</Number>')
    expect(twiml).not.toContain('<Number>+17197498807</Number>')
    expect(twiml).toContain('/api/twilio/dial-failover?mode=open-line')
  })

  it('uses option 2 for water damage during business hours', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-07T16:00:00Z'))
    getCallRoutingConfigMock.mockResolvedValue({
      ...routingConfig,
      temporaryOpenLineMode: false,
    })

    const response = await POST(twilioRequest())
    const twiml = await response.text()

    expect(twiml).toContain('To book or change an appointment, press 1.')
    expect(twiml).toContain(
      'For active water damage, a burst pipe, or flooding, press 2.',
    )
    expect(twiml).not.toContain('technical help')
    expect(twiml).toContain('/api/twilio/ivr-menu')
  })

  it('offers the water-damage option before voicemail after hours', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T16:00:00Z'))
    getCallRoutingConfigMock.mockResolvedValue({
      ...routingConfig,
      temporaryOpenLineMode: false,
    })

    const response = await POST(twilioRequest())
    const twiml = await response.text()

    expect(twiml).toContain(
      'If you have active water damage, a burst pipe, or flooding, press 2 now.',
    )
    expect(twiml).not.toContain('press 1')
    expect(twiml).toContain('/api/twilio/ivr-menu?context=after-hours')
    expect(twiml).toContain('/api/twilio/call-after-hours')
  })
})
