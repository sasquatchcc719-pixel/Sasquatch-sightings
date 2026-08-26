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

function twilioRequest(
  status: string,
  { mode, stage }: { mode?: string; stage?: string } = {},
): NextRequest {
  const body = new URLSearchParams()
  body.set('DialCallStatus', status)
  body.set('From', '+17195550123')
  const query = new URLSearchParams()
  if (mode) query.set('mode', mode)
  if (stage) query.set('stage', stage)
  const search = query.size ? `?${query}` : ''

  return new NextRequest(
    `https://sightings.sasquatchcarpet.com/api/twilio/dial-failover${search}`,
    {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  )
}

describe('POST /api/twilio/dial-failover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCallRoutingConfigMock.mockResolvedValue(routingConfig)
  })

  it('does not dial the secondary phone after the primary call was handled', async () => {
    const response = await POST(
      twilioRequest('completed', { mode: 'schedule' }),
    )

    expect(await response.text()).toBe('<Response><Hangup/></Response>')
    expect(getCallRoutingConfigMock).not.toHaveBeenCalled()
  })

  it('dials the secondary phone after the primary phone does not answer', async () => {
    const response = await POST(
      twilioRequest('no-answer', { mode: 'schedule' }),
    )
    const twiml = await response.text()

    expect(twiml).toContain('<Number>+17197498807</Number>')
    expect(twiml.match(/<Number>/g)).toHaveLength(1)
    expect(twiml).not.toContain('<Number>+17206447577</Number>')
    expect(twiml).toContain('timeout="45"')
    expect(twiml).toContain('callerId="+17195550123"')
    expect(twiml).not.toContain('<Client>admin_charles</Client>')
    expect(twiml).toContain('/api/twilio/dial-failover?stage=secondary')
  })

  it('keeps the browser softphone on the secondary technical call', async () => {
    const response = await POST(twilioRequest('busy', { mode: 'technical' }))
    const twiml = await response.text()

    expect(twiml).toContain('<Number>+17197498807</Number>')
    expect(twiml).toContain('timeout="20"')
    expect(twiml).toContain('<Client>admin_charles</Client>')
  })

  it('goes to voicemail instead of dialing the same phone twice', async () => {
    getCallRoutingConfigMock.mockResolvedValue({
      ...routingConfig,
      secondaryForwardNumber: routingConfig.primaryForwardNumber,
    })

    const response = await POST(twilioRequest('failed', { mode: 'open-line' }))
    const twiml = await response.text()

    expect(twiml).toContain('/api/twilio/call-after-hours')
    expect(twiml).not.toContain('<Dial')
  })

  it('sends an unanswered secondary call to voicemail', async () => {
    const response = await POST(
      twilioRequest('no-answer', { stage: 'secondary' }),
    )
    const twiml = await response.text()

    expect(twiml).toContain('/api/twilio/call-after-hours')
    expect(twiml).not.toContain('<Dial')
    expect(getCallRoutingConfigMock).not.toHaveBeenCalled()
  })
})
