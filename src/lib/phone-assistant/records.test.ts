import { describe, expect, it, vi } from 'vitest'
import { formatVoiceTranscript, type VoiceSession } from './records'
import { buildVoiceSummaryEmail } from './summary-email'

vi.mock('@/supabase/server', () => ({ createAdminClient: vi.fn() }))
const session: VoiceSession = {
  callSid: 'CA' + 'a'.repeat(32),
  callerPhone: '+13035550141',
  providerCallId: null,
  pilot: true,
  startedAt: '2026-11-19T08:00:00Z',
  answeredAt: '2026-11-19T08:00:01Z',
  endedAt: '2026-11-19T08:05:00Z',
  status: 'ended',
  summary: null,
  turns: [
    { role: 'user', content: 'Call me tomorrow' },
    { role: 'assistant', content: 'I will leave a message.' },
  ],
}
describe('voice call records', () => {
  it('attributes each turn and identifies the private preview', () => {
    expect(formatVoiceTranscript(session)).toBe(
      'Private preview\nCaller: Call me tomorrow\nPhone assistant: I will leave a message.',
    )
  })
  it('emails only the recap, labels simulations, escapes customer text, and links the exact call', () => {
    const email = buildVoiceSummaryEmail(session, {
      topic: 'Callback requested',
      summary: 'Casey asked about <tile> & carpet.',
    })
    expect(email.subject).toContain('Private preview')
    expect(email.html).toContain('&lt;tile&gt; &amp; carpet')
    expect(email.html).toContain('View full transcript in Sightings')
    expect(email.html).toContain(
      '/admin/phone-assistant?call=' + session.callSid,
    )
    expect(email.text).not.toContain('Call me tomorrow')
  })
})

const resendEmail = vi.hoisted(() => vi.fn())
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resendEmail }
  },
}))
import type { SupabaseClient } from '@supabase/supabase-js'
import { deliverPendingVoiceSummaries } from './summary-email'

function workerDb(
  firstAttempt: string,
  emailPayload: ReturnType<typeof buildVoiceSummaryEmail>,
  claimed = true,
) {
  const writes: Record<string, unknown>[] = []
  const from = () => {
    let write: Record<string, unknown> | undefined
    const chain = {
      eq: () => chain,
      lte: () => chain,
      order: () => chain,
      select: () => chain,
      limit: async () => ({
        data: [
          { call_sid: session.callSid, next_email_at: '2026-11-19T08:06:30Z' },
        ],
        error: null,
      }),
      update: (data: Record<string, unknown>) => {
        write = data
        writes.push(data)
        return chain
      },
      maybeSingle: async () => ({
        data: claimed
          ? {
              first_email_attempt_at: firstAttempt,
              email_payload: emailPayload,
            }
          : null,
        error: null,
      }),
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: write, error: null }),
    }
    return chain
  }
  return { db: { from } as unknown as SupabaseClient, writes }
}

describe('durable owner recap delivery', () => {
  const frozen = buildVoiceSummaryEmail(session, {
    topic: 'Callback requested',
    summary: 'The caller asked for a morning callback.',
  })
  it('retries with the persisted payload and the same per-call provider key', async () => {
    vi.stubEnv('RESEND_API_KEY', 'unused-mocked-provider')
    try {
      resendEmail
        .mockReset()
        .mockResolvedValueOnce({ error: { message: 'temporary' }, data: null })
        .mockResolvedValueOnce({ error: null, data: { id: 'provider-test' } })
      const { db, writes } = workerDb(new Date().toISOString(), frozen)
      await expect(deliverPendingVoiceSummaries(db)).rejects.toThrow(
        'temporary',
      )
      expect(writes).not.toContainEqual({
        email_status: 'sent',
        email_id: 'provider-test',
      })
      await deliverPendingVoiceSummaries(db)
      expect(resendEmail.mock.calls).toEqual(
        Array(2).fill([
          frozen,
          { idempotencyKey: 'phone-assistant-recap-v1/' + session.callSid },
        ]),
      )
      expect(writes).toContainEqual({
        email_status: 'sent',
        email_id: 'provider-test',
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('does not send when another worker claims the email or an ambiguous attempt is older than the dedupe window', async () => {
    resendEmail.mockClear()
    await deliverPendingVoiceSummaries(
      workerDb(new Date().toISOString(), frozen, false).db,
    )
    const old = workerDb(new Date(Date.now() - 86400_000).toISOString(), frozen)
    await deliverPendingVoiceSummaries(old.db)
    expect(old.writes).toContainEqual({ email_status: 'review' })
    expect(resendEmail).not.toHaveBeenCalled()
  })
})
