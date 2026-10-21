import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createAdminClientMock, getCallRoutingConfigMock, writeCallLogMock } =
  vi.hoisted(() => ({
    writeCallLogMock: vi.fn(),
    createAdminClientMock: vi.fn(),
    getCallRoutingConfigMock: vi.fn(),
  }))

vi.mock('@/lib/twilio/call-routing-config', () => ({
  getCallRoutingConfig: getCallRoutingConfigMock,
}))

vi.mock('@/supabase/server', () => ({
  createAdminClient: createAdminClientMock,
}))
vi.mock('@/lib/twilio/call-history', () => ({ writeCallLog: writeCallLogMock }))

vi.mock('@/lib/twilio/inbound-auth', () => ({
  validateTwilioInboundRequest: vi.fn(() => true),
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
  {
    mode,
    stage,
    duration,
    callSid = 'CA123',
    screened = false,
    bridged,
  }: {
    mode?: string
    stage?: string
    duration?: number
    callSid?: string
    screened?: boolean
    bridged?: string
  } = {},
): NextRequest {
  const body = new URLSearchParams()
  body.set('CallSid', callSid)
  body.set('DialCallStatus', status)
  if (bridged !== undefined) body.set('DialBridged', bridged)
  if (duration !== undefined) body.set('DialCallDuration', String(duration))
  body.set('From', '+17195550123')
  const query = new URLSearchParams()
  if (mode) query.set('mode', mode)
  if (stage) query.set('stage', stage)
  if (screened) query.set('screened', '1')
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
    writeCallLogMock.mockResolvedValue(undefined)
    getCallRoutingConfigMock.mockResolvedValue(routingConfig)
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => ({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
      })),
    })
  })

  it('does not dial the secondary phone after the primary call was handled', async () => {
    const response = await POST(
      twilioRequest('completed', { mode: 'schedule' }),
    )

    expect(await response.text()).toBe('<Response><Hangup/></Response>')
    expect(getCallRoutingConfigMock).not.toHaveBeenCalled()
    expect(createAdminClientMock).toHaveBeenCalled()
  })

  it('records an answered primary call before hanging up', async () => {
    const upsert = vi.fn(() => Promise.resolve({ error: null }))
    createAdminClientMock.mockReturnValue({ from: vi.fn(() => ({ upsert })) })

    const response = await POST(
      twilioRequest('completed', { mode: 'schedule', duration: 45 }),
    )

    expect(await response.text()).toBe('<Response><Hangup/></Response>')
    expect(writeCallLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        call_sid: 'CA123',
        outcome: 'answered',
        duration_seconds: 45,
        raw_dial_status: 'completed',
      }),
    )
  })

  it('dials the secondary phone after the primary phone does not answer', async () => {
    const response = await POST(
      twilioRequest('no-answer', { mode: 'schedule' }),
    )
    const twiml = await response.text()

    expect(twiml).toMatch(/<Number[^>]*>\+17197498807<\/Number>/)
    expect(twiml.match(/<Number[ >]/g)).toHaveLength(1)
    expect(twiml).not.toContain('<Number>\+17206447577</Number>')
    expect(twiml).toContain('timeout="45"')
    expect(twiml).toContain('callerId="+17195550123"')
    expect(twiml).not.toContain('<Client>admin_charles</Client>')
    expect(twiml).toContain('/api/twilio/dial-failover?stage=secondary')
  })

  it('keeps the browser softphone on the secondary water-damage call', async () => {
    const response = await POST(twilioRequest('busy', { mode: 'water-damage' }))
    const twiml = await response.text()

    expect(twiml).toMatch(/<Number[^>]*>\+17197498807<\/Number>/)
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
    const upsert = vi.fn(() => Promise.resolve({ error: null }))
    createAdminClientMock.mockReturnValue({ from: vi.fn(() => ({ upsert })) })

    const response = await POST(
      twilioRequest('no-answer', { stage: 'secondary' }),
    )
    const twiml = await response.text()

    expect(twiml).toContain('/api/twilio/call-after-hours')
    expect(twiml).not.toContain('<Dial')
    expect(getCallRoutingConfigMock).not.toHaveBeenCalled()
    expect(writeCallLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        call_sid: 'CA123',
        outcome: 'no-answer',
        raw_dial_status: 'no-answer',
      }),
    )
  })

  it('ends a short answered call without dialing the secondary phone', async () => {
    const response = await POST(twilioRequest('completed', { duration: 7 }))
    expect(await response.text()).toBe('<Response><Hangup/></Response>')
    expect(getCallRoutingConfigMock).not.toHaveBeenCalled()
    expect(writeCallLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: 'answered', duration_seconds: 7 }),
    )
  })
  it('continues to Charles when the primary carrier voicemail answers without acceptance', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { forwarding_accepted_at: null },
        error: null,
      }),
    }
    createAdminClientMock.mockReturnValue({ from: vi.fn(() => query) })
    const xml = await (
      await POST(
        twilioRequest('completed', { mode: 'open-line', screened: true }),
      )
    ).text()
    expect(xml).toMatch(/<Number[^>]*>\+17197498807<\/Number>/)
    expect(xml).toContain('screened=1&amp;mode=open-line&amp;stage=secondary')
  })
  it('hangs up after a screened call was explicitly accepted', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { forwarding_accepted_at: '2026-10-21T18:00:00Z' },
        error: null,
      }),
    }
    createAdminClientMock.mockReturnValue({ from: vi.fn(() => query) })
    expect(
      await (await POST(twilioRequest('completed', { screened: true }))).text(),
    ).toContain('<Hangup/>')
  })
  it('does not call a second phone after the caller canceled', async () => {
    expect(
      await (await POST(twilioRequest('canceled', { screened: true }))).text(),
    ).toContain('<Hangup/>')
  })
  it('uses signed provider bridge evidence when the database is unavailable', async () => {
    createAdminClientMock.mockImplementation(() => {
      throw new Error('DB down')
    })
    const xml = await (
      await POST(
        twilioRequest('completed', { screened: true, bridged: 'true' }),
      )
    ).text()
    expect(xml).toContain('<Hangup/>')
  })
  it('still attempts Charles after an unaccepted primary during a database outage', async () => {
    createAdminClientMock.mockImplementation(() => {
      throw new Error('DB down')
    })
    const xml = await (
      await POST(
        twilioRequest('completed', { screened: true, bridged: 'false' }),
      )
    ).text()
    expect(xml).toMatch(/<Number[^>]*>\+17197498807<\/Number>/)
  })
})
