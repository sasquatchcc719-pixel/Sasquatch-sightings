import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getCallRoutingConfigMock, admin, update, push, auth } = vi.hoisted(
  () => ({
    admin: vi.fn(),
    update: vi.fn(),
    push: vi.fn(),
    auth: vi.fn(),
    getCallRoutingConfigMock: vi.fn(),
  }),
)

vi.mock('@/lib/twilio/call-routing-config', () => ({
  getCallRoutingConfig: getCallRoutingConfigMock,
}))

vi.mock('@/supabase/server', () => ({ createAdminClient: admin }))
vi.mock('@/lib/onesignal', () => ({ sendOneSignalNotification: push }))
vi.mock('@/lib/twilio/inbound-auth', () => ({
  validateTwilioInboundRequest: auth,
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
  digits: string,
  { context, attempt }: { context?: string; attempt?: string } = {},
): NextRequest {
  const body = new URLSearchParams()
  body.set('CallSid', 'CA123')
  body.set('Digits', digits)
  body.set('From', '+17195550123')

  const query = new URLSearchParams()
  if (context) query.set('context', context)
  if (attempt) query.set('attempt', attempt)
  const search = query.size ? `?${query}` : ''

  return new NextRequest(
    `https://sightings.sasquatchcarpet.com/api/twilio/ivr-menu${search}`,
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
    auth.mockReturnValue(true)
    push.mockResolvedValue(undefined)
    update.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    admin.mockReturnValue({ from: vi.fn(() => ({ update })) })
    getCallRoutingConfigMock.mockResolvedValue(routingConfig)
  })

  it('puts scheduling callers into the appointment queue with hold music', async () => {
    const response = await POST(twilioRequest('1'))
    const twiml = await response.text()

    expect(twiml).toContain('<Enqueue')
    expect(twiml).toContain('event=wait')
    expect(twiml).toContain('>sasquatch-appointments</Enqueue>')
    expect(twiml).not.toContain('<Dial')
    expect(update).toHaveBeenCalledWith({
      appointment_queued_at: expect.any(String),
    })
  })

  it('dials the primary water-damage phone before the secondary-stage softphone', async () => {
    const response = await POST(twilioRequest('2', { context: 'after-hours' }))
    const twiml = await response.text()

    expect(twiml).toMatch(/<Number[^>]*>\+17206447577<\/Number>/)
    expect(twiml).not.toContain('<Number>\+17197498807</Number>')
    expect(twiml).toContain(
      '/api/twilio/dial-failover?screened=1&amp;mode=water-damage',
    )
    expect(twiml).not.toContain('<Client>admin_charles</Client>')
  })

  it('does not route scheduling calls from the after-hours menu', async () => {
    const response = await POST(twilioRequest('1', { context: 'after-hours' }))
    const twiml = await response.text()

    expect(twiml).toContain('/api/twilio/call-after-hours')
    expect(twiml).not.toContain('<Dial')
  })
  it.each(['', '9'])(
    'repeats the menu once for no/invalid selection %s without ringing',
    async (digits) => {
      const xml = await (await POST(twilioRequest(digits))).text()
      expect(xml).toContain('<Gather')
      expect(xml).toContain('attempt=1')
      expect(xml).not.toContain('<Dial')
      expect(push).not.toHaveBeenCalled()
      expect(update).toHaveBeenCalledWith({
        caller_screening_status: 'pending',
      })
    },
  )
  it.each(['', '9'])(
    'sends unanswered repeat %s to voicemail without ringing',
    async (digits) => {
      const xml = await (
        await POST(twilioRequest(digits, { attempt: '1' }))
      ).text()
      expect(xml).toContain('/api/twilio/call-after-hours')
      expect(xml).not.toContain('<Dial')
      expect(xml).not.toContain('<Gather')
      expect(push).not.toHaveBeenCalled()
      expect(update).toHaveBeenCalledWith({
        caller_screening_status: 'voicemail',
      })
    },
  )
  it.each(['1', '2'])(
    'records valid choice %s before ringing and notifying',
    async (digits) => {
      const xml = await (
        await POST(twilioRequest(digits, { attempt: '1' }))
      ).text()
      expect(xml).toContain(digits === '1' ? '<Enqueue' : '<Dial')
      expect(update).toHaveBeenCalledWith({ caller_screening_status: 'passed' })
      expect(push).toHaveBeenCalledOnce()
    },
  )
  it('rejects an unsigned attempt to bypass the caller screen', async () => {
    auth.mockReturnValue(false)
    expect((await POST(twilioRequest('1'))).status).toBe(403)
    expect(update).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })
})
