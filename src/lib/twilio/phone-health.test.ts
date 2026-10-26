// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Twilio } from 'twilio'
import {
  deliverPhoneHealthAlert,
  forwardingExpectedAt,
  inspectPhoneCall,
  runPhoneHealthCheck,
} from './phone-health'
const mocks = vi.hoisted(() => ({ send: vi.fn(), config: vi.fn() }))
vi.mock('@/lib/telegram', () => ({ sendTelegramNotification: mocks.send }))
vi.mock('./call-routing-config', () => ({ getCallRoutingConfig: mocks.config }))
const now = new Date('2026-10-21T18:20:00Z')
const config = {
  temporaryOpenLineMode: false,
  businessHoursStart: 9,
  businessHoursEnd: 17,
  businessDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  primaryForwardNumber: '+17206447577',
  secondaryForwardNumber: '+17197498807',
  failoverForwardNumber: '+17206447577',
  openLineTimeoutSeconds: 30,
  ivrScheduleTimeoutSeconds: 30,
  ivrTechnicalTimeoutSeconds: 30,
}
const parent = {
  sid: 'CAparent',
  parentCallSid: '',
  from: '+17195551234',
  to: '+17192498791',
  direction: 'inbound',
  status: 'completed',
  startTime: new Date('2026-10-21T18:00:00Z'),
  endTime: new Date('2026-10-21T18:02:00Z'),
  duration: '120',
}
const child = {
  ...parent,
  sid: 'CAchild',
  parentCallSid: parent.sid,
  to: config.primaryForwardNumber,
  direction: 'outbound-dial',
  status: 'no-answer',
  endTime: new Date('2026-10-21T18:01:00Z'),
}
const recording = {
  sid: 'REvoicemail',
  callSid: parent.sid,
  source: 'RecordVerb',
  status: 'completed',
  duration: '10',
  dateCreated: parent.endTime,
}
type Parent = Parameters<typeof inspectPhoneCall>[0]
type Recording = Parameters<typeof inspectPhoneCall>[2][number]
function inspect(
  p = parent,
  children = [] as (typeof child)[],
  recordings = [] as (typeof recording)[],
  stored = { outcome: 'no-answer', recording_url: null } as Parameters<
    typeof inspectPhoneCall
  >[3],
) {
  return inspectPhoneCall(
    p as Parent,
    children as Parent[],
    recordings as Recording[],
    stored,
    config,
    now,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.config.mockResolvedValue(config)
  mocks.send.mockResolvedValue(true)
})
describe('provider evidence checks', () => {
  it('recognizes queued callers without requiring a separate dial per caller', () => {
    expect(
      inspect(parent, [], [], {
        outcome: 'no-answer',
        recording_url: null,
        caller_screening_status: 'passed',
        appointment_queued_at: '2026-10-22T18:00:00Z',
      }).issues,
    ).toEqual([])
  })
  it('detects a business-hours menu bypass even when local call logs are absent', () => {
    expect(inspect(parent, [], [], null).issues.map((i) => i.issue)).toEqual([
      'No forwarding attempt during business hours',
      'Inbound call missing from call log',
    ])
  })
  it.each(['pending', 'voicemail'] as const)(
    'does not treat intentional menu filtering (%s) as failed forwarding',
    (status) => {
      expect(
        inspect(parent, [], [], {
          outcome: 'no-answer',
          recording_url: null,
          caller_screening_status: status,
        }).issues,
      ).toEqual([])
    },
  )
  it.each(['passed', 'bypassed'] as const)(
    'requires forwarding after the menu is satisfied or bypassed (%s)',
    (status) => {
      expect(
        inspect(parent, [], [], {
          outcome: 'no-answer',
          recording_url: null,
          caller_screening_status: status,
        }).issues.map((issue) => issue.issue),
      ).toEqual(['Required forwarding was not attempted'])
    },
  )
  it('requires forwarding for a valid after-hours water-damage selection', () => {
    expect(
      inspect(
        {
          ...parent,
          startTime: new Date('2026-10-21T12:00:00Z'),
          endTime: new Date('2026-10-21T12:02:00Z'),
        },
        [],
        [],
        {
          outcome: 'no-answer',
          recording_url: null,
          caller_screening_status: 'passed',
        },
      ).issues.map((issue) => issue.issue),
    ).toEqual(['Required forwarding was not attempted'])
  })
  it('still checks recording persistence for a caller sent to voicemail by the menu', () => {
    expect(
      inspect(parent, [], [recording], {
        outcome: 'no-answer',
        recording_url: null,
        caller_screening_status: 'voicemail',
      }).issues.map((issue) => issue.issue),
    ).toEqual(['Voicemail recording missing from call log'])
  })
  it('still checks final outcome callbacks when a pending-menu caller hangs up', () => {
    expect(
      inspect(parent, [], [], {
        outcome: 'inbound',
        recording_url: null,
        caller_screening_status: 'pending',
      }).issues.map((issue) => issue.issue),
    ).toEqual(['Call outcome callback was not saved'])
  })
  it('retains legacy business-hours monitoring for an explicit null screening status', () => {
    expect(
      inspect(parent, [], [], {
        outcome: 'no-answer',
        recording_url: null,
        caller_screening_status: null,
      }).issues.map((issue) => issue.issue),
    ).toEqual(['No forwarding attempt during business hours'])
  })
  it('uses Mountain business hours at call start, not the monitor run time', () => {
    expect(forwardingExpectedAt(new Date('2026-10-21T14:59:00Z'), config)).toBe(
      false,
    )
    expect(forwardingExpectedAt(new Date('2026-10-21T15:00:00Z'), config)).toBe(
      true,
    )
    expect(forwardingExpectedAt(new Date('2026-10-22T00:00:00Z'), config)).toBe(
      false,
    )
    expect(forwardingExpectedAt(new Date('2026-10-25T18:00:00Z'), config)).toBe(
      false,
    )
    expect(
      forwardingExpectedAt(new Date('2026-10-25T18:00:00Z'), {
        ...config,
        temporaryOpenLineMode: true,
      }),
    ).toBe(true)
  })
  it('does not alarm on after-hours voicemail without forwarding', () => {
    expect(
      inspect({
        ...parent,
        startTime: new Date('2026-10-21T12:00:00Z'),
        endTime: new Date('2026-10-21T12:02:00Z'),
      }).issues,
    ).toEqual([])
  })
  it('skips live calls, blocked calls, and brief abandonment explicitly', () => {
    expect(inspect({ ...parent, status: 'in-progress' }).skipped).toBe('active')
    expect(
      inspect(parent, [], [], { outcome: 'blacklisted', recording_url: null })
        .skipped,
    ).toBe('blacklisted')
    expect(
      inspect({ ...parent, endTime: new Date('2026-10-21T18:00:04Z') }).skipped,
    ).toBe('short')
  })
  it('flags failure and missing secondary after the first no-answer while caller stayed', () => {
    expect(
      inspect(parent, [{ ...child, status: 'failed' }]).issues.map(
        (i) => i.issue,
      ),
    ).toEqual(['Forwarding leg failed', 'Secondary phone was not attempted'])
  })
  it('detects a carrier-voicemail answer that bypassed the required secondary', () => {
    expect(
      inspect(parent, [{ ...child, status: 'completed' }], [], {
        outcome: 'no-answer',
        recording_url: null,
        forwarding_required: true,
        forwarding_accepted_at: null,
      }).issues.map((i) => i.issue),
    ).toContain('Secondary phone was not attempted')
  })
  it('accepts a legitimate accepted first answer and normal two-phone no-answer', () => {
    expect(
      inspect(parent, [{ ...child, status: 'completed' }], [], {
        outcome: 'answered',
        recording_url: null,
        forwarding_required: true,
        forwarding_accepted_at: parent.startTime.toISOString(),
      }).issues,
    ).toEqual([])
    expect(
      inspect(parent, [child, { ...child, to: config.secondaryForwardNumber }])
        .issues,
    ).toEqual([])
  })
  it('does not require a second phone when the caller already hung up', () => {
    expect(
      inspect({ ...parent, endTime: child.endTime }, [child]).issues,
    ).toEqual([])
  })
  it('checks the exact voicemail recording after callback grace', () => {
    expect(
      inspect(
        parent,
        [child, { ...child, to: config.secondaryForwardNumber }],
        [recording],
        {
          outcome: 'voicemail',
          recording_url: 'https://api.twilio.com/REother.mp3',
        },
      ).issues.map((i) => i.issue),
    ).toEqual(['Voicemail recording missing from call log'])
    expect(
      inspect(
        parent,
        [child, { ...child, to: config.secondaryForwardNumber }],
        [recording],
        {
          outcome: 'voicemail',
          recording_url: 'https://api.twilio.com/REvoicemail.mp3',
        },
      ).issues,
    ).toEqual([])
  })
})

describe('durable notification delivery', () => {
  const item = {
    key: 'call:issue',
    issue: 'Call failed',
    details: { callSid: 'CAparent' },
  }
  function database(claim = true) {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn(() => ({ eq }))
    const db = {
      rpc: vi.fn().mockResolvedValue({ data: claim, error: null }),
      from: vi.fn(() => ({ update })),
    }
    return { db: db as unknown as SupabaseClient, update }
  }
  it('marks an alert sent only on confirmed Telegram success', async () => {
    const { db, update } = database()
    expect(await deliverPhoneHealthAlert(db, item)).toBe(true)
    expect(update).toHaveBeenCalledWith({
      lease_until: null,
      sent_at: expect.any(String),
    })
    expect(mocks.send).toHaveBeenCalledWith(
      expect.stringContaining('Call failed'),
    )
  })
  it('releases a failed send so the next run can retry', async () => {
    const { db, update } = database()
    mocks.send.mockResolvedValue(false)
    await expect(deliverPhoneHealthAlert(db, item)).rejects.toThrow(
      'retry is pending',
    )
    expect(update).toHaveBeenCalledWith({ lease_until: null })
  })
  it('still warns the owner when monitor error storage is unavailable', async () => {
    const { db } = database()
    vi.mocked(db.rpc).mockResolvedValue({
      data: null,
      error: new Error('Storage unavailable'),
    } as never)
    await expect(
      deliverPhoneHealthAlert(db, { ...item, key: 'monitor-error:today' }),
    ).rejects.toThrow('Storage unavailable')
    expect(mocks.send).toHaveBeenCalledWith(
      expect.stringContaining('Alert storage is unavailable'),
    )
  })
  it('does not resend already sent or leased alerts', async () => {
    const { db } = database(false)
    expect(await deliverPhoneHealthAlert(db, item)).toBe(false)
    expect(mocks.send).not.toHaveBeenCalled()
  })
})

function fixture(
  options: {
    pendingAlert?: boolean
    transcript?: string
    transcriptAccepted?: boolean
    recordingEmailAccepted?: boolean
    recordingCompleted?: boolean
    legacyTranscript?: boolean
    providerError?: boolean
    capped?: boolean
    missingConversation?: boolean
    misconfigured?: boolean
    rollout?: string
    realConversationQuery?: boolean
  } = {},
) {
  const write = vi.fn().mockResolvedValue({ error: null })
  const query = (table: string) => {
    const result =
      table === 'phone_health_alerts'
        ? options.pendingAlert
          ? [
              {
                alert_key: 'old-call:issue',
                issue: 'An earlier phone alert is pending',
                details: { callSid: 'old-call' },
              },
            ]
          : []
        : table === 'phone_health_state'
          ? { checked_at: options.rollout || '2026-10-21T17:00:00Z' }
          : table === 'phone_settings'
            ? { id: 1 }
            : table === 'call_logs'
              ? {
                  outcome: 'voicemail',
                  recording_url: 'https://api.twilio.com/REvoicemail.mp3',
                }
              : options.missingConversation
                ? []
                : [
                    {
                      id: 'real-caller-conversation',
                      messages: [
                        {
                          metadata: {
                            recording_sid: recording.sid,
                            recording_completed:
                              options.recordingCompleted ?? true,
                            email_sent: options.recordingEmailAccepted ?? true,
                            transcription: options.transcript,
                            transcription_email_text: options.legacyTranscript
                              ? null
                              : options.transcript,
                            transcription_email_id: options.transcriptAccepted
                              ? 'email-1'
                              : null,
                          },
                        },
                      ],
                    },
                  ]
    if (table === 'conversations' && options.realConversationQuery) {
      return createClient('https://phone-health.test', 'test-key', {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: async (input) => {
            const url = new URL(String(input))
            expect(url.searchParams.get('phone_number')).toBe(
              `eq.${parent.from}`,
            )
            expect(url.searchParams.get('source')).toBe('eq.inbound')
            const filter = url.searchParams.get('messages')!
            expect(filter.startsWith('cs.')).toBe(true)
            expect(JSON.parse(filter.slice(3))).toEqual([
              { metadata: { recording_sid: recording.sid } },
            ])
            return new Response(JSON.stringify(result), {
              headers: { 'Content-Type': 'application/json' },
            })
          },
        },
      }).from(table)
    }
    const q = {
      select: vi.fn(),
      eq: vi.fn(),
      contains: vi.fn(),
      is: vi.fn(),
      limit: vi.fn(),
      single: vi.fn(),
      maybeSingle: vi.fn(),
      upsert: write,
      update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
    }
    const resolved = { data: result, error: null }
    q.select.mockReturnValue(q)
    q.eq.mockReturnValue(q)
    q.contains.mockReturnValue(q)
    q.is.mockReturnValue(q)
    q.limit.mockImplementation(() =>
      ['conversations', 'phone_health_alerts'].includes(table)
        ? Promise.resolve(resolved)
        : q,
    )
    q.single.mockResolvedValue(resolved)
    q.maybeSingle.mockResolvedValue(resolved)
    return q
  }
  const db = {
    from: vi.fn(query),
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
  }
  const base = 'https://sightings.sasquatchcarpet.com/api/twilio/'
  const client = {
    monitor: {
      v1: {
        alerts: {
          list: vi.fn().mockResolvedValue(
            options.providerError
              ? [
                  {
                    sid: 'NOerror',
                    dateCreated: parent.startTime,
                    resourceSid: parent.sid,
                    requestUrl: base + 'call-router',
                    errorCode: '11200',
                  },
                ]
              : [],
          ),
        },
      },
    },
    incomingPhoneNumbers: {
      list: vi.fn().mockResolvedValue([
        {
          phoneNumber: parent.to,
          voiceUrl: base + (options.misconfigured ? 'wrong' : 'call-router'),
          voiceMethod: 'POST',
          statusCallback: base + 'call-status',
          statusCallbackMethod: 'POST',
          voiceFallbackUrl: base + 'call-fallback',
          voiceFallbackMethod: 'POST',
        },
      ]),
    },
    calls: {
      list: vi
        .fn()
        .mockResolvedValue(
          options.capped
            ? Array(1000).fill(parent)
            : [parent, child, { ...child, to: config.secondaryForwardNumber }],
        ),
    },
    recordings: { list: vi.fn().mockResolvedValue([recording]) },
  }
  return {
    db: db as unknown as SupabaseClient,
    client: client as unknown as Twilio,
    write,
  }
}
describe('independent scheduled monitor', () => {
  it('sends valid JSON containment through the real query builder for a saved voicemail', async () => {
    const { db, client } = fixture({ realConversationQuery: true })
    expect(await runPhoneHealthCheck(db, client, parent.to, now)).toMatchObject(
      {
        callsChecked: 1,
        issues: 0,
        errors: [],
      },
    )
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('preserves Supabase error fields, the failed check, and the last failure after recovery', async () => {
    const { db, client, write } = fixture()
    const error = {
      code: '57014',
      message: 'canceling statement due to statement timeout',
      details: 'Database is overloaded',
      hint: 'Check disk IO',
    }
    vi.mocked(db.from).mockImplementationOnce(
      () =>
        ({
          select: () => ({
            eq: () => ({ single: async () => ({ data: null, error }) }),
          }),
        }) as never,
    )
    const summary = await runPhoneHealthCheck(db, client, parent.to, now)
    expect(summary.errors[0]).toContain(error.message)
    expect(summary.errors[0]).toContain(error.code)
    expect(summary.errors[0]).not.toContain('[object Object]')
    expect(mocks.send).toHaveBeenCalledWith(
      expect.stringContaining(error.details),
    )
    expect(mocks.send).toHaveBeenCalledWith(
      expect.stringContaining('stage: load monitor settings'),
    )
    expect(write).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ key: 'last-error', summary }),
        expect.objectContaining({ key: 'latest', summary }),
      ]),
      { onConflict: 'key' },
    )
    write.mockClear()
    await runPhoneHealthCheck(db, client, parent.to, now)
    expect(write).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          key: 'latest',
          summary: expect.objectContaining({ errors: [] }),
        }),
      ],
      { onConflict: 'key' },
    )
  })
  it('includes the original check error when alert storage is also unavailable', async () => {
    const { db } = fixture()
    vi.mocked(db.rpc).mockResolvedValue({
      data: null,
      error: { message: 'upstream request timeout' },
    } as never)
    await expect(
      deliverPhoneHealthAlert(db, {
        key: 'monitor-error:today',
        issue: 'Phone monitor could not complete its checks',
        details: {
          stage: 'load monitor settings',
          error: 'Database statement timed out',
        },
      }),
    ).rejects.toMatchObject({ message: 'upstream request timeout' })
    expect(mocks.send).toHaveBeenCalledWith(
      expect.stringContaining('Database statement timed out'),
    )
  })
  it('retries undelivered alerts even after the call leaves the hourly window', async () => {
    const { db, client } = fixture({ pendingAlert: true })
    expect(await runPhoneHealthCheck(db, client, parent.to, now)).toMatchObject(
      { issues: 1, alertsSent: 1 },
    )
    expect(mocks.send).toHaveBeenCalledWith(
      expect.stringContaining('earlier phone alert is pending'),
    )
  })
  it('persists a heartbeat with complete provider checks', async () => {
    const { db, client, write } = fixture()
    const summary = await runPhoneHealthCheck(db, client, parent.to, now)
    expect(summary).toMatchObject({
      configChecked: true,
      callsChecked: 1,
      issues: 0,
      errors: [],
    })
    expect(write).toHaveBeenCalledWith(
      [expect.objectContaining({ key: 'latest', summary })],
      { onConflict: 'key' },
    )
  })
  it('alerts on wrong provider webhook settings', async () => {
    const { db, client } = fixture({ misconfigured: true })
    expect(await runPhoneHealthCheck(db, client, parent.to, now)).toMatchObject(
      { issues: 1, alertsSent: 1, errors: [] },
    )
    expect(mocks.send).toHaveBeenCalledWith(
      expect.stringContaining('voiceUrl is misconfigured'),
    )
  })
  it('surfaces provider webhook failures even when fallback forwarding worked', async () => {
    const { db, client } = fixture({ providerError: true })
    expect(await runPhoneHealthCheck(db, client, parent.to, now)).toMatchObject(
      { issues: 1, alertsSent: 1, errors: [] },
    )
    expect(mocks.send).toHaveBeenCalledWith(
      expect.stringContaining('webhook error'),
    )
  })
  it('fails closed and reports incomplete capped results', async () => {
    const { db, client } = fixture({ capped: true })
    const summary = await runPhoneHealthCheck(db, client, parent.to, now)
    expect(summary.errors[0]).toContain('safety cap')
    expect(summary.callsChecked).toBe(0)
    expect(mocks.send).toHaveBeenCalledWith(
      expect.stringContaining('could not complete'),
    )
  })
  it('finds recordings absent from the actual caller conversation', async () => {
    const { db, client } = fixture({ missingConversation: true })
    expect(await runPhoneHealthCheck(db, client, parent.to, now)).toMatchObject(
      { issues: 1, alertsSent: 1 },
    )
    expect(mocks.send).toHaveBeenCalledWith(
      expect.stringContaining('correct caller conversation'),
    )
  })
  it('alerts when a ready transcript email has not been accepted, even if a legacy recording email was sent', async () => {
    const { db, client } = fixture({ transcript: 'Please call me back.' })
    expect(await runPhoneHealthCheck(db, client, parent.to, now)).toMatchObject(
      { issues: 1, alertsSent: 1 },
    )
    expect(mocks.send).toHaveBeenCalledWith(
      expect.stringContaining('transcription email was not accepted'),
    )
  })
  it.each([undefined, '', '(No transcription available)', 'none'])(
    'does not demand an email while waiting for a transcript: %s',
    async (transcript) => {
      const { db, client } = fixture({
        transcript,
        recordingEmailAccepted: false,
      })
      expect(
        await runPhoneHealthCheck(db, client, parent.to, now),
      ).toMatchObject({ issues: 0, errors: [] })
      expect(mocks.send).not.toHaveBeenCalled()
    },
  )
  it('accepts an email with its persisted transcript provider id', async () => {
    const { db, client } = fixture({
      transcript: 'Call me.',
      transcriptAccepted: true,
    })
    expect(await runPhoneHealthCheck(db, client, parent.to, now)).toMatchObject(
      { issues: 0, errors: [] },
    )
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('checks legacy raw transcripts and does not require a local recording-completion marker', async () => {
    const { db, client } = fixture({
      transcript: 'Call me.',
      legacyTranscript: true,
      recordingCompleted: false,
    })
    expect(await runPhoneHealthCheck(db, client, parent.to, now)).toMatchObject(
      { issues: 1, errors: [] },
    )
    expect(mocks.send).toHaveBeenCalledWith(
      expect.stringContaining('transcription email was not accepted'),
    )
  })
  it('allows callback grace before checking a ready transcript email', async () => {
    const { db, client } = fixture({ transcript: 'Call me.' })
    expect(
      await runPhoneHealthCheck(
        db,
        client,
        parent.to,
        new Date('2026-10-21T18:04:00Z'),
      ),
    ).toMatchObject({ issues: 0, errors: [] })
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('flags missing or duplicate forwarding targets before a call is missed', async () => {
    const { db, client } = fixture()
    mocks.config.mockResolvedValue({
      ...config,
      secondaryForwardNumber: config.primaryForwardNumber,
    })
    expect(await runPhoneHealthCheck(db, client, parent.to, now)).toMatchObject(
      { issues: 2 },
    )
    expect(mocks.send).toHaveBeenCalledWith(
      expect.stringContaining('two distinct valid'),
    )
  })
  it('ignores historical calls before rollout to prevent retroactive alert floods', async () => {
    const { db, client } = fixture({ rollout: '2026-10-21T18:10:00Z' })
    expect(await runPhoneHealthCheck(db, client, parent.to, now)).toMatchObject(
      { callsChecked: 0, issues: 0 },
    )
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
