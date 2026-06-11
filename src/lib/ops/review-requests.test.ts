// @vitest-environment node
/**
 * Integration tests for the post-job review request engine, against the real
 * DB. The SMS sender and owner notifier are injected fakes — no real text is
 * ever sent. Rows created during the test (tracked by start timestamp) are
 * deleted afterward so the production cron launches from a clean slate.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import {
  buildReviewRequestMessage,
  enqueueReviewRequests,
  processDueReviewRequests,
  isWithinSendWindow,
  GOOGLE_REVIEW_URL,
} from './review-requests'

describe('isWithinSendWindow (Mountain Time)', () => {
  it('allows mid-day and blocks the night', () => {
    // 18:00 UTC = 12pm MDT — inside the window.
    expect(isWithinSendWindow(new Date('2026-06-11T18:00:00Z'))).toBe(true)
    // 09:00 UTC = 3am MDT — outside.
    expect(isWithinSendWindow(new Date('2026-06-11T09:00:00Z'))).toBe(false)
    // 01:30 UTC = 7:30pm MDT previous evening — outside (window ends 7pm).
    expect(isWithinSendWindow(new Date('2026-06-12T01:30:00Z'))).toBe(false)
  })
})

describe('buildReviewRequestMessage', () => {
  it('greets by first name and includes the verified review link', () => {
    const msg = buildReviewRequestMessage({
      first_name: 'Tiffany',
      full_name: 'Tiffany Sewell',
    })
    expect(msg).toContain('Hi Tiffany')
    expect(msg).toContain('Sasquatch Carpet Cleaning')
    expect(msg).toContain(GOOGLE_REVIEW_URL)
  })

  it('falls back to a generic greeting without a name', () => {
    const msg = buildReviewRequestMessage({ first_name: null, full_name: null })
    expect(msg).toContain("Hi, it's Charles")
    expect(msg).toContain(GOOGLE_REVIEW_URL)
  })
})

describe('review request pipeline against the real DB', () => {
  const supabase = createAdminClient()
  const testStart = new Date().toISOString()

  beforeAll(async () => {
    // Sanity: the engine tables exist.
    const { error } = await supabase
      .from('review_requests')
      .select('id')
      .limit(1)
    expect(error).toBeNull()
  })

  afterAll(async () => {
    await supabase.from('review_requests').delete().gte('created_at', testStart)
  })

  it('enqueues completed appointments with correct timing and guards', async () => {
    const result = await enqueueReviewRequests(supabase)

    const { data: rows } = await supabase
      .from('review_requests')
      .select(
        'id, appointment_id, customer_id, status, skip_reason, scheduled_for',
      )
      .gte('created_at', testStart)

    expect((rows || []).length).toBe(result.queued + result.skipped)
    for (const row of rows || []) {
      expect(['pending', 'skipped']).toContain(row.status)
      if (row.status === 'skipped') {
        expect(row.skip_reason).toBeTruthy()
      }
    }

    // Re-running must be idempotent — nothing new gets queued.
    const second = await enqueueReviewRequests(supabase)
    expect(second.queued).toBe(0)
  })

  it('sends a due request via the injected sender and records it', async () => {
    const { data: pendingRow } = await supabase
      .from('review_requests')
      .select('id, customer_id')
      .eq('status', 'pending')
      .gte('created_at', testStart)
      .limit(1)
      .maybeSingle()

    if (!pendingRow) return // no eligible completions in the last 48h right now

    // Force the row due, then process at a fixed mid-day MT time.
    await supabase
      .from('review_requests')
      .update({ scheduled_for: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', pendingRow.id)

    const sentMessages: Array<{ phone: string; message: string }> = []
    const notices: string[] = []
    const result = await processDueReviewRequests(supabase, {
      sendSms: async (phone, message) => {
        sentMessages.push({ phone, message })
      },
      notifyOwner: async (text) => {
        notices.push(text)
      },
      now: new Date(new Date().setUTCHours(18, 0, 0, 0)),
    })

    expect(result.deferred).toBe(false)
    expect(result.sent).toBeGreaterThanOrEqual(1)
    expect(sentMessages.length).toBeGreaterThanOrEqual(1)
    expect(sentMessages[0].message).toContain(GOOGLE_REVIEW_URL)

    const { data: after } = await supabase
      .from('review_requests')
      .select('status, sent_at, message')
      .eq('id', pendingRow.id)
      .single()
    expect(after?.status).toBe('sent')
    expect(after?.sent_at).toBeTruthy()
    expect(after?.message).toContain(GOOGLE_REVIEW_URL)
  })

  it('defers everything outside the send window', async () => {
    const result = await processDueReviewRequests(supabase, {
      sendSms: async () => {
        throw new Error('must not send outside window')
      },
      now: new Date('2026-06-11T09:00:00Z'), // 3am MT
    })
    expect(result.deferred).toBe(true)
    expect(result.sent).toBe(0)
  })
})
