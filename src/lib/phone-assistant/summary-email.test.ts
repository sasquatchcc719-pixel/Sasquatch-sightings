import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceSession } from './records'
import { buildVoiceSummaryEmail, summarizeVoiceCall } from './summary-email'

const extract = vi.hoisted(() => vi.fn())
vi.mock('ai', () => ({ generateText: extract, Output: { object: vi.fn() } }))
vi.mock('@/supabase/server', () => ({ createAdminClient: vi.fn() }))

const session: VoiceSession = {
  callSid: 'CA' + 'a'.repeat(32),
  callerPhone: '+13035550141',
  providerCallId: 'test-call',
  pilot: false,
  startedAt: '',
  answeredAt: '',
  endedAt: '',
  status: 'ended',
  summary: null,
  turns: [
    { role: 'user', content: 'Three rooms and one sofa, please.' },
    {
      role: 'assistant',
      content:
        "You're booked for November 24th at 3 p.m. The estimate is $378.",
    },
  ],
}
const booked = {
  id: 'abcde001-1111-2222-3333-444444444444',
  status: 'booked',
  parked_at: null,
  appointment_date: '2026-11-24',
  start_time: '15:00:00',
}
function receiptDb(
  data: Record<string, unknown> | null,
  error: Error | null = null,
) {
  const eq = vi
    .fn()
    .mockReturnValue({ maybeSingle: async () => ({ data, error }) })
  const from = vi.fn().mockReturnValue({ select: () => ({ eq }) })
  return { eq, from, db: { from } as unknown as SupabaseClient }
}
beforeEach(() => {
  extract.mockReset().mockResolvedValue({
    output: {
      topic: 'Message',
      bookingRequestedOrPromised: false,
      excerpts: [
        { role: 'user', quote: 'Three rooms and one sofa' },
        { role: 'assistant', quote: '$378' },
        { role: 'assistant', quote: 'No outstanding action.' },
      ],
    },
  })
})

describe('after-hours booking receipts', () => {
  it('flags a spoken confirmation without a saved appointment even if the model missed the topic', async () => {
    const { db, eq, from } = receiptDb(null)
    const recap = await summarizeVoiceCall(session, db)
    expect(from).toHaveBeenCalledWith('ops_appointments')
    expect(eq).toHaveBeenCalledWith('phone_assistant_call_sid', session.callSid)
    expect(recap.topic).toBe('Follow-up needed')
    expect(recap.summary).toContain('No appointment is linked to this call')
    expect(recap.summary).toContain('Three rooms and one sofa')
    expect(recap.summary).toContain('$378')
    expect(recap.summary).not.toContain('No outstanding action')
    expect(buildVoiceSummaryEmail(session, recap).subject).toContain(
      'Follow-up needed',
    )
  })
  it('flags a promise to finalize when the caller agrees and hangs up without a receipt', async () => {
    const turns: VoiceSession['turns'] = [
      { role: 'assistant', content: 'Do you confirm?' },
      { role: 'user', content: 'Yes.' },
      {
        role: 'assistant',
        content:
          "Great. I'll finalize that now and make sure everything matches.",
      },
      { role: 'user', content: 'Am I okay to hang up now.' },
      { role: 'assistant', content: 'Yes.' },
    ]
    const recap = await summarizeVoiceCall(
      { ...session, turns },
      receiptDb(null).db,
    )
    expect(recap.topic).toBe('Follow-up needed')
    expect(recap.summary).toContain('No appointment is linked')
  })
  it('displays the receipt from the database even when the transcript promises a different time', async () => {
    const { db } = receiptDb({ ...booked, start_time: '14:00:00' })
    const recap = await summarizeVoiceCall(session, db)
    expect(recap.topic).toBe('Booking verified')
    expect(recap.summary).toContain('SC-ABCDE001')
    expect(recap.summary).toContain('2026-11-24 at 14:00 Mountain Time')
  })
  it('reports the measuring visit with its estimate receipt', async () => {
    const recap = await summarizeVoiceCall(
      session,
      receiptDb({ ...booked, kind: 'estimate', status: 'confirmed' }).db,
    )
    expect(recap.topic).toBe('Measuring visit verified')
    expect(recap.summary).toContain('commercial measuring visit EST-ABCDE001')
    expect(recap.summary).not.toContain('SC-')
  })
  it.each([
    { ...booked, status: 'pending_approval' },
    { ...booked, parked_at: '2026-11-20T18:00:00Z' },
    { ...booked, status: 'cancelled' },
  ])('preserves non-scheduled appointment state for review', async (row) => {
    const recap = await summarizeVoiceCall(session, receiptDb(row).db)
    expect(recap.topic).toBe('Review appointment status')
    expect(recap.summary).toContain(
      row.parked_at ? 'unscheduled' : row.status.replaceAll('_', ' '),
    )
  })
  it('cannot promote a simulation to a real receipt', async () => {
    const { db, from } = receiptDb(booked)
    const recap = await summarizeVoiceCall({ ...session, pilot: true }, db)
    expect(from).not.toHaveBeenCalled()
    expect(recap.summary).toContain('simulated')
  })
  it('retries failed receipt reads and still alerts staff if transcript classification fails', async () => {
    await expect(
      summarizeVoiceCall(session, receiptDb(null, new Error('unavailable')).db),
    ).rejects.toThrow('unavailable')
    expect(extract).not.toHaveBeenCalled()
    extract.mockRejectedValueOnce(new Error('unavailable'))
    const recap = await summarizeVoiceCall(session, receiptDb(null).db)
    expect(recap.topic).toBe('Follow-up needed')
    expect(recap.summary).toContain('full transcript')
  })
})
