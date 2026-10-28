// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { loadUnscheduledActivity } from './unscheduled-activity'

const job = {
  customer_id: 'customer-1',
  parked_at: '2026-10-20T15:00:00Z',
  customer: { phone: '(719) 555-0100' },
}
function fixture(
  overrides: Record<string, unknown> = {},
  failedTable?: string,
) {
  const tables: Record<string, unknown> = {
    ops_appointments: job,
    ops_unscheduled_follow_up_events: [
      {
        id: 'review',
        occurred_at: '2026-10-28T20:00:00Z',
        event_type: 'review',
        note: 'Waiting for dates',
        actor_label: 'Connected assistant · Harry',
        next_follow_up_date: '2026-10-30',
        next_follow_up_time: '14:30:00',
      },
    ],
    sms_logs: [
      {
        id: 'sms',
        sent_at: '2026-10-28T19:00:00Z',
        status: 'failed',
        message_content: 'Try again',
        sent_by: 'Harry',
        twilio_sid: 'SM1',
      },
    ],
    conversations: [
      {
        id: 'conversation',
        messages: [
          {
            role: 'assistant',
            timestamp: '2026-10-28T19:00:00Z',
            content: 'Try again',
            twilio_sid: 'SM1',
          },
          {
            role: 'user',
            timestamp: '2026-10-28T19:30:00Z',
            content: 'Friday please',
          },
          { role: 'system', content: 'Internal note' },
          { role: 'user', content: 'Legacy message without a timestamp' },
        ],
      },
    ],
    call_logs: [
      {
        id: 'call',
        created_at: '2026-10-27T19:00:00Z',
        direction: 'inbound',
        outcome: 'no-answer',
        duration_seconds: 30,
      },
    ],
    ops_email_log: [
      {
        id: 'email',
        sent_at: '2026-10-26T19:00:00Z',
        status: 'sent',
        subject: 'Cleaning estimate',
      },
    ],
    ops_customer_email_history: [],
    ...overrides,
  }
  const queries: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {}
  const from = vi.fn((table: string) => {
    const q: Record<string, ReturnType<typeof vi.fn>> = {}
    for (const method of ['select', 'eq', 'not', 'or', 'order', 'limit', 'in'])
      q[method] = vi.fn().mockReturnValue(q)
    const result = {
      data: tables[table],
      error: table === failedTable ? new Error('Database unavailable') : null,
    }
    q.maybeSingle = vi.fn().mockResolvedValue(result)
    q.then = vi.fn((resolve) => Promise.resolve(result).then(resolve))
    queries[table] = q
    return q
  })
  return { db: { from } as never, from, queries }
}
it('merges actual communications and review plans, deduplicating provider messages without inventing dates or successful delivery', async () => {
  const f = fixture()
  const { events } = await loadUnscheduledActivity(f.db, 'job')
  expect(events.map((event) => event.id)).toEqual([
    'review:review',
    'message:conversation:1',
    'sms:sms',
    'call:call',
    'email:email',
    'parked:job',
    'message:conversation:3',
  ])
  expect(events[0]).toMatchObject({
    next_time: '14:30',
    detail: 'Waiting for dates',
  })
  expect(events[2].title).toBe('Outgoing text · failed')
  expect(events[3].title).toBe('Incoming call · no-answer')
  expect(events.at(-1)?.at).toBeNull()
})
it('matches stable customer IDs and restricts phone fallback to unlinked records', async () => {
  const f = fixture()
  await loadUnscheduledActivity(f.db, 'job')
  expect(f.queries.sms_logs.or).toHaveBeenCalledWith(
    'customer_id.eq.customer-1,and(customer_id.is.null,recipient_phone.in.(7195550100,17195550100,+17195550100))',
  )
  expect(f.queries.conversations.or).toHaveBeenCalledWith(
    'ops_customer_id.eq.customer-1,and(ops_customer_id.is.null,phone_number.in.(7195550100,17195550100,+17195550100))',
  )
})
it('includes both sides of imported Gmail exchanges at their original times', async () => {
  const f = fixture({
    ops_customer_email_history: [
      {
        id: 'reply',
        occurred_at: '2026-10-26T18:33:28Z',
        direction: 'inbound',
        subject: 'Re: Cleaning',
        body_text: 'After November 1 please',
        message_id: '1a1798436c57eef1',
      },
      {
        id: 'answer',
        occurred_at: '2026-10-26T19:01:43Z',
        direction: 'outbound',
        subject: 'Re: Cleaning',
        body_text: 'Which day would work?',
        message_id: '1a17997073ad944e',
      },
    ],
  })
  const { events } = await loadUnscheduledActivity(f.db, 'job')
  expect(
    events.filter((e) => e.id.startsWith('gmail:')).map((e) => [e.title, e.at]),
  ).toEqual([
    ['Outgoing email · Gmail', '2026-10-26T19:01:43Z'],
    ['Customer email received · Gmail', '2026-10-26T18:33:28Z'],
  ])
  expect(f.queries.ops_customer_email_history.eq).toHaveBeenCalledWith(
    'customer_id',
    'customer-1',
  )
  await expect(
    loadUnscheduledActivity(
      fixture({}, 'ops_customer_email_history').db,
      'job',
    ),
  ).rejects.toThrow('Database unavailable')
})
it('surfaces missing jobs and partial history failures', async () => {
  const missing = fixture({ ops_appointments: null })
  await expect(loadUnscheduledActivity(missing.db, 'job')).rejects.toThrow(
    'not found',
  )
  expect(missing.from).toHaveBeenCalledTimes(1)
  await expect(
    loadUnscheduledActivity(fixture({}, 'sms_logs').db, 'job'),
  ).rejects.toThrow('Database unavailable')
})
it('does not build phone filters for missing or invalid numbers', async () => {
  const f = fixture({
    ops_appointments: { ...job, customer: { phone: 'no phone' } },
  })
  await loadUnscheduledActivity(f.db, 'job')
  expect(f.from).not.toHaveBeenCalledWith('call_logs')
  expect(f.queries.sms_logs.or).toHaveBeenCalledWith(
    'customer_id.eq.customer-1',
  )
})
