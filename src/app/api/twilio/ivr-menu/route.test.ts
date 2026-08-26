import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getCallRoutingConfigMock } = vi.hoisted(() => ({
  getCallRoutingConfigMock: vi.fn(),
}))

vi.mock('@/lib/twilio/call-routing-config', () => ({
  getCallRoutingConfig: getCallRoutingConfigMock,
}))

import { POST } from './route'

const routingConfig = {
  temporaryOpenLineMode: false,
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

function twilioRequest(digits: string): NextRequest {
  const body = new URLSearchParams()
  body.set('Digits', digits)
  body.set('From', '+17195550123')

  return new NextRequest(
    'https://sightings.sasquatchcarpet.com/api/twilio/ivr-menu',
    {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  )
}

describe('POST /api/twilio/ivr-menu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCallRoutingConfigMock.mockResolvedValue(routingConfig)
  })

  it('dials the primary scheduling phone before failover', async () => {
    const response = await POST(twilioRequest('1'))
    const twiml = await response.text()

    expect(twiml).toContain('<Number>+17206447577</Number>')
    expect(twiml).not.toContain('<Number>+17197498807</Number>')
    expect(twiml).toContain('/api/twilio/dial-failover?mode=schedule')
  })

  it('dials the primary technical phone before the secondary-stage softphone', async () => {
    const response = await POST(twilioRequest('2'))
    const twiml = await response.text()

    expect(twiml).toContain('<Number>+17206447577</Number>')
    expect(twiml).not.toContain('<Number>+17197498807</Number>')
    expect(twiml).toContain('/api/twilio/dial-failover?mode=technical')
    expect(twiml).not.toContain('<Client>admin_charles</Client>')
  })
})
