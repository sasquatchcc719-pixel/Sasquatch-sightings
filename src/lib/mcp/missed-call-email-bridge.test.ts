// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildMissedCallOwnerEmail,
  deliverPendingMissedCallEmails,
  enqueueMissedCallEmailBridge,
  MISSED_CALL_EMAIL_IDEMPOTENCY_PREFIX,
  MISSED_CALL_EMAIL_SUBJECT_PREFIX,
} from './missed-call-email-bridge'

const callSid = `CA${'1'.repeat(32)}`
const conversationId = '10000000-0000-4000-8000-000000000001'
const startedAt = '2026-11-12T05:20:00.000Z'
const endedAt = '2026-11-12T05:20:30.000Z'
const token = '20000000-0000-4000-8000-000000000002'

function finalizedCall() {
  return {
    callSid,
    phone: '+17195550100',
    outcome: 'no-answer',
    startedAt,
    endedAt,
  }
}

function enqueueDatabase(insertError: unknown = null) {
  const insert = vi.fn().mockResolvedValue({ error: insertError })
  const rpc = vi.fn().mockResolvedValue({
    data: conversationId,
    error: null,
  })
  return {
    db: { rpc, from: () => ({ insert }) },
    insert,
    rpc,
  }
}

function deliveryDatabase(rowCount = 1) {
  const finishes: Array<Record<string, unknown>> = []
  const query: Record<string, any> = {}
  for (const method of ['select', 'eq', 'lte', 'order']) {
    query[method] = vi.fn(() => query)
  }
  query.limit = vi.fn().mockResolvedValue({
    data: Array.from({ length: rowCount }, (_, index) => ({
      call_sid: `CA${String(index + 1).repeat(32)}`,
    })),
    error: null,
  })
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'claim_missed_call_email_notification') {
      return {
        data: {
          eligible: true,
          call_sid: callSid,
          token,
          conversation_id: conversationId,
          occurred_at: startedAt,
          finalized_at: endedAt,
          sender: 'Sasquatch Carpet Cleaning <noreply@sasquatchcarpet.com>',
          recipient: 'sasquatchcc719@gmail.com',
          subject: `${MISSED_CALL_EMAIL_SUBJECT_PREFIX} ${callSid}`,
          body_text: 'verified body',
        },
        error: null,
      }
    }
    finishes.push(args)
    return { data: null, error: null }
  })
  return {
    db: { from: () => query, rpc },
    finishes,
    rpc,
  }
}

describe('missed-call owner email bridge', () => {
  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 'test-resend-key')
    vi.stubEnv(
      'OPS_EMAIL_FROM',
      'Sasquatch Carpet Cleaning <noreply@sasquatchcarpet.com>',
    )
    vi.stubEnv('OWNER_ALERT_EMAIL', 'sasquatchcc719@gmail.com')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('builds a fixed factual notice with no invented caller message', () => {
    const email = buildMissedCallOwnerEmail({
      callSid,
      conversationId,
      occurredAt: startedAt,
      finalizedAt: endedAt,
    })
    expect(email.subject).toBe(`${MISSED_CALL_EMAIL_SUBJECT_PREFIX} ${callSid}`)
    expect(email.text).toContain(`CallSid: ${callSid}`)
    expect(email.text).toContain(`Provider started at: ${startedAt}`)
    expect(email.text).toContain(`Conversation ID: ${conversationId}`)
    expect(email.text).toContain('contains no caller message')
  })

  it('enqueues only the real context returned for a signed finalized callback', async () => {
    const fixture = enqueueDatabase()
    await expect(
      enqueueMissedCallEmailBridge(fixture.db as never, finalizedCall()),
    ).resolves.toBe(true)
    expect(fixture.rpc).toHaveBeenCalledWith(
      'ensure_missed_call_bridge_conversation',
      { p_call_sid: callSid },
    )
    expect(fixture.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        call_sid: callSid,
        conversation_id: conversationId,
        occurred_at: startedAt,
        finalized_at: endedAt,
        sender: 'Sasquatch Carpet Cleaning <noreply@sasquatchcarpet.com>',
        recipient: 'sasquatchcc719@gmail.com',
      }),
    )
  })

  it('fails closed when the verified sender configuration is absent', async () => {
    vi.stubEnv('OPS_EMAIL_FROM', '')
    await expect(
      enqueueMissedCallEmailBridge(
        enqueueDatabase().db as never,
        finalizedCall(),
      ),
    ).rejects.toThrow('OPS_EMAIL_FROM is not configured')
  })

  it('rejects a configured sender or recipient that is not the verified owner path', async () => {
    vi.stubEnv('OPS_EMAIL_FROM', 'Other Sender <other@example.com>')
    await expect(
      enqueueMissedCallEmailBridge(
        enqueueDatabase().db as never,
        finalizedCall(),
      ),
    ).rejects.toThrow('not the verified Sasquatch sender')
    vi.stubEnv(
      'OPS_EMAIL_FROM',
      'Sasquatch Carpet Cleaning <noreply@sasquatchcarpet.com>',
    )
    vi.stubEnv('OWNER_ALERT_EMAIL', 'someone@example.com')
    await expect(
      enqueueMissedCallEmailBridge(
        enqueueDatabase().db as never,
        finalizedCall(),
      ),
    ).rejects.toThrow('not the verified owner mailbox')
  })

  it('does not enqueue answered calls or duplicate CallSids', async () => {
    const fixture = enqueueDatabase({ code: '23505' })
    await expect(
      enqueueMissedCallEmailBridge(fixture.db as never, {
        ...finalizedCall(),
        outcome: 'answered',
      }),
    ).resolves.toBe(false)
    expect(fixture.rpc).not.toHaveBeenCalled()
    await expect(
      enqueueMissedCallEmailBridge(fixture.db as never, finalizedCall()),
    ).resolves.toBe(false)
  })

  it('sends once with provider idempotency and records acceptance', async () => {
    const fixture = deliveryDatabase()
    const sendEmail = vi.fn().mockResolvedValue({ id: 'resend-notice-1' })
    await expect(
      deliverPendingMissedCallEmails({
        db: fixture.db as never,
        sendEmail,
      }),
    ).resolves.toEqual({
      accepted: 1,
      suppressed: 0,
      rejected: 0,
      unknown: 0,
    })
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `${MISSED_CALL_EMAIL_IDEMPOTENCY_PREFIX}${callSid}`,
      }),
    )
    expect(fixture.finishes).toContainEqual(
      expect.objectContaining({
        p_call_sid: callSid,
        p_token: token,
        p_status: 'accepted',
        p_provider_id: 'resend-notice-1',
      }),
    )
  })

  it('refuses a claimed row whose stored delivery path is not the verified owner path', async () => {
    const fixture = deliveryDatabase()
    fixture.rpc.mockImplementationOnce(async () => ({
      data: {
        eligible: true,
        call_sid: callSid,
        token,
        conversation_id: conversationId,
        occurred_at: startedAt,
        finalized_at: endedAt,
        sender: 'Other <other@example.com>',
        recipient: 'someone@example.com',
        subject: `${MISSED_CALL_EMAIL_SUBJECT_PREFIX} ${callSid}`,
        body_text: 'verified body',
      },
      error: null,
    }))
    const sendEmail = vi.fn()
    const result = await deliverPendingMissedCallEmails({
      db: fixture.db as never,
      sendEmail,
    })
    expect(result.rejected).toBe(1)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('makes an uncertain provider outcome terminal instead of retrying', async () => {
    const fixture = deliveryDatabase()
    const sendEmail = vi.fn().mockRejectedValue(new Error('socket reset'))
    await expect(
      deliverPendingMissedCallEmails({
        db: fixture.db as never,
        sendEmail,
      }),
    ).resolves.toEqual({
      accepted: 0,
      suppressed: 0,
      rejected: 0,
      unknown: 1,
    })
    expect(sendEmail).toHaveBeenCalledOnce()
    expect(fixture.finishes).toContainEqual(
      expect.objectContaining({ p_status: 'unknown' }),
    )
  })

  it.each([
    [{ error: { message: 'invalid sender', statusCode: 422 } }, 'rejected'],
    [
      { error: { message: 'provider unavailable', statusCode: 503 } },
      'unknown',
    ],
    [{}, 'unknown'],
  ] as const)(
    'classifies returned provider outcomes without blind retries: %j',
    async (providerResult, expectedStatus) => {
      const fixture = deliveryDatabase()
      const sendEmail = vi.fn().mockResolvedValue(providerResult)
      const result = await deliverPendingMissedCallEmails({
        db: fixture.db as never,
        sendEmail,
      })
      expect(result[expectedStatus]).toBe(1)
      expect(fixture.finishes).toContainEqual(
        expect.objectContaining({ p_status: expectedStatus }),
      )
    },
  )

  it('leaves later rows pending when the cron deadline needs provider and finalization headroom', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-12T05:30:00Z'))
    const fixture = deliveryDatabase(2)
    const sendEmail = vi.fn().mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 31_000)
      return { id: 'resend-notice-1' }
    })
    await deliverPendingMissedCallEmails({
      db: fixture.db as never,
      sendEmail,
    })
    expect(sendEmail).toHaveBeenCalledOnce()
    expect(fixture.rpc).toHaveBeenCalledTimes(2)
  })
})
