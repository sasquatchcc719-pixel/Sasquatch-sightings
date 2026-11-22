import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deliverPhoneBookingEmails } from './phone-booking-email'

const { prepare, send } = vi.hoisted(() => ({
  prepare: vi.fn(),
  send: vi.fn(),
}))
vi.mock('./communications', () => ({ preparePhoneBookingEmail: prepare }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

function fixture() {
  const payload = {
    origin: 'phone_booking',
    date: '2027-01-04',
    time: '15:00',
    total: 378,
    to: 'sample@example.test',
  }
  const row: Record<string, unknown> = {
    id: 'queue-id',
    appointment_id: 'job',
    customer_id: 'customer',
    scheduled_for: '2026-01-01',
    template_key: 'job_scheduled_email',
    status: 'pending',
    payload,
  }
  const log = vi.fn().mockResolvedValue({ error: null })
  function from(table: string) {
    if (table === 'ops_email_log') return { upsert: log }
    let patch: Record<string, unknown> | null = null
    const filters: Array<[string, unknown]> = []
    const matches = () =>
      filters.every(([field, value]) => row[field] === value)
    const apply = () =>
      matches()
        ? (Object.assign(row, patch), { data: { id: row.id }, error: null })
        : { data: null, error: null }
    const query = {
      select: () => query,
      update: (value: Record<string, unknown>) => ((patch = value), query),
      contains: () => query,
      lte: () => query,
      order: () => query,
      eq: (field: string, value: unknown) => (
        filters.push([field, value]),
        query
      ),
      limit: () =>
        Promise.resolve({
          data: matches() ? [structuredClone(row)] : [],
          error: null,
        }),
      single: apply,
      maybeSingle: apply,
    }
    return query
  }
  return {
    db: { from } as unknown as Parameters<typeof deliverPhoneBookingEmails>[0],
    row,
    log,
  }
}
beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 'test')
  prepare.mockReset().mockResolvedValue({
    body: 'Customer booking',
    message: {
      from: 'sender@example.test',
      to: 'sample@example.test',
      subject: 'Booked',
      html: '<p>Booked</p>',
    },
  })
  send.mockReset().mockResolvedValue({ data: { id: 'accepted' }, error: null })
})
describe('phone booking confirmation delivery', () => {
  it('recovers a provider rejection using the exact saved payload and idempotency key', async () => {
    const { db, row, log } = fixture()
    send.mockResolvedValueOnce({
      data: null,
      error: { message: 'temporarily unavailable' },
    })
    await expect(deliverPhoneBookingEmails(db)).rejects.toThrow(
      'temporarily unavailable',
    )
    expect(log).not.toHaveBeenCalled()
    expect(row.status).toBe('pending')
    expect(row.error_message).toBe('temporarily unavailable')
    await deliverPhoneBookingEmails(db)
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0])
    expect(row.status).toBe('sent')
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ resend_id: 'accepted', status: 'sent' }),
      expect.anything(),
    )
    await deliverPhoneBookingEmails(db)
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('has a single delivery owner if the immediate handler and cron race', async () => {
    const { db, log } = fixture()
    await Promise.all([
      deliverPhoneBookingEmails(db),
      deliverPhoneBookingEmails(db, 'job'),
    ])
    expect(send).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledTimes(1)
  })
  it('suppresses a cancelled or changed booking without contacting the customer', async () => {
    const { db, row } = fixture()
    prepare.mockResolvedValue(null)
    await deliverPhoneBookingEmails(db)
    expect(send).not.toHaveBeenCalled()
    expect(row.status).toBe('cancelled')
  })
  it('requires review after the safe provider retry window', async () => {
    const { db, row } = fixture()
    Object.assign(row.payload as object, { firstAttempt: '2000-01-01' })
    await deliverPhoneBookingEmails(db)
    expect(row.status).toBe('failed')
    expect(send).not.toHaveBeenCalled()
  })
})
