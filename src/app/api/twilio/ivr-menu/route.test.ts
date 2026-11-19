import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getCallRoutingConfigMock, admin, update, push, auth, access } =
  vi.hoisted(() => ({
    admin: vi.fn(),
    update: vi.fn(),
    push: vi.fn(),
    access: vi.fn(),
    auth: vi.fn(),
    getCallRoutingConfigMock: vi.fn(),
  }))

vi.mock('@/lib/twilio/harry-access', () => ({
  getHarryAccess: access,
  isHarryMainNumber: (number: string) => number === '+17195550000',
}))

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
  {
    context,
    attempt,
    flood,
  }: { context?: string; attempt?: string; flood?: string } = {},
): NextRequest {
  const body = new URLSearchParams()
  body.set('CallSid', 'CA123')
  body.set('Digits', digits)
  body.set('From', '+17195550123')
  body.set('To', '+17195550000')

  const query = new URLSearchParams()
  if (context) query.set('context', context)
  if (flood) query.set('flood', flood)
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
    access.mockResolvedValue({ preview: false, publicEnabled: false })
    push.mockResolvedValue(undefined)
    update.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    admin.mockReturnValue({ from: vi.fn(() => ({ update })) })
    getCallRoutingConfigMock.mockResolvedValue(routingConfig)
  })

  it('puts scheduling callers into the appointment queue with hold music', async () => {
    const response = await POST(twilioRequest('2'))
    const twiml = await response.text()

    expect(twiml).toContain('<Enqueue')
    expect(twiml).toContain('event=wait')
    expect(twiml).toContain('>sasquatch-appointments</Enqueue>')
    expect(twiml).not.toContain('<Dial')
    expect(update).toHaveBeenCalledWith({
      appointment_queued_at: expect.any(String),
    })
  })

  it('dials Charles directly for water damage at any hour', async () => {
    const response = await POST(twilioRequest('1', { context: 'after-hours' }))
    const twiml = await response.text()

    expect(twiml).toMatch(/<Number[^>]*>\+17197498807<\/Number>/)
    expect(twiml).not.toContain('>+17206447577</Number>')
    expect(twiml).toContain(
      '/api/twilio/dial-failover?screened=1&amp;mode=water-damage',
    )
    expect(twiml).toContain('stage=secondary')
    expect(twiml).toContain('>admin_charles</Client>')
  })

  it('sends scheduling selections to voicemail after hours', async () => {
    const response = await POST(twilioRequest('2', { context: 'after-hours' }))
    const twiml = await response.text()

    expect(twiml).not.toContain('<Enqueue')
    expect(twiml).toContain('/api/twilio/call-after-hours')
    expect(update).toHaveBeenCalledWith({
      caller_screening_status: 'voicemail',
    })
  })
  it.each(['', '9'])(
    'sends after-hours non-emergency selection %s straight to voicemail',
    async (digits) => {
      const xml = await (
        await POST(twilioRequest(digits, { context: 'after-hours' }))
      ).text()
      expect(xml).toContain('/api/twilio/call-after-hours')
      expect(xml).not.toContain('<Gather')
      expect(xml).not.toContain('<Dial')
      expect(push).not.toHaveBeenCalled()
    },
  )
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
      expect(xml).toContain(digits === '2' ? '<Enqueue' : '<Dial')
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
  it('requires an active caller preview and valid digit before reaching the assistant', async () => {
    const request = () => twilioRequest('1', { context: 'harry-preview' })
    expect(await (await POST(request())).text()).toContain('<Hangup')
    access.mockResolvedValue({ preview: true, publicEnabled: false })
    expect(await (await POST(request())).text()).toContain(
      'harry-voice?step=start&amp;preview=1',
    )
    expect(push).not.toHaveBeenCalled()
    auth.mockReturnValue(false)
    expect((await POST(request())).status).toBe(403)
  })

  it('simulates emergency transfer and voicemail in preview without live side effects', async () => {
    access.mockResolvedValue({ preview: true, publicEnabled: false })
    const xml = async (digit: string, flood?: string) =>
      (
        await POST(twilioRequest(digit, { context: 'harry-preview', flood }))
      ).text()
    expect(await xml('2')).toContain('flood=confirm')
    expect(await xml('1', 'confirm')).toContain('simulated')
    for (const digit of ['', '9']) expect(await xml(digit)).toContain('<Hangup')
    expect(admin).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('preserves the advertised public number assignments through a switch change', async () => {
    const xml = async (digit: string, flood?: string) =>
      (
        await POST(twilioRequest(digit, { context: 'harry-public', flood }))
      ).text()
    expect(await xml('1')).toContain('call-after-hours')
    expect(await xml('2')).toContain('flood=confirm')
    expect(await xml('9', 'confirm')).toContain('call-after-hours')
    expect(await xml('1', 'confirm')).toContain('stage=secondary')
    access.mockResolvedValue({ preview: false, publicEnabled: true })
    expect(await xml('1')).toContain('harry-voice?step=start&amp;preview=0')
  })
})
