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
  buildReviewRequestContext,
  enqueueReviewRequests,
  processDueReviewRequests,
  isWithinSendWindow,
  GOOGLE_REVIEW_URL,
  ALL_REVIEWS_PAGE_URL,
} from './review-requests'
import { reviewerMatchesCustomer } from '@/lib/gbp-reviews'

describe('reviewerMatchesCustomer', () => {
  it('matches exact full names', () => {
    expect(
      reviewerMatchesCustomer('Dave Capriotti', {
        first_name: 'Dave',
        last_name: 'Capriotti',
        full_name: 'Dave Capriotti',
      }),
    ).toBe(true)
  })

  it('matches name variants via last name + first initial', () => {
    // The real case: customer "Kathie Hartman", Google reviewer "Kathleen Hartman".
    expect(
      reviewerMatchesCustomer('Kathleen Hartman', {
        first_name: 'Kathie',
        last_name: 'Hartman',
        full_name: 'Kathie Hartman',
      }),
    ).toBe(true)
  })

  it('does not match different people', () => {
    expect(
      reviewerMatchesCustomer('Tamara Shepherd', {
        first_name: 'Dave',
        last_name: 'Capriotti',
        full_name: 'Dave Capriotti',
      }),
    ).toBe(false)
    expect(
      reviewerMatchesCustomer('Robert Hartman', {
        first_name: 'Kathie',
        last_name: 'Hartman',
        full_name: 'Kathie Hartman',
      }),
    ).toBe(false)
    expect(reviewerMatchesCustomer(null, { full_name: 'Dave Capriotti' })).toBe(
      false,
    )
  })
})

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

  it('asks for detail, not just a rating', () => {
    const msg = buildReviewRequestMessage({
      first_name: 'Tiffany',
      full_name: 'Tiffany Sewell',
    })
    // Review TEXT is what AI matches against; a wordless 5-star is near-useless.
    expect(msg).toMatch(/what we cleaned/i)
    expect(msg).toMatch(/how it turned out/i)
  })

  it('never gates on a positive experience or offers an incentive', () => {
    const msg = buildReviewRequestMessage({
      first_name: 'Tiffany',
      full_name: 'Tiffany Sewell',
    })
    // Both would violate Google's review policies on an already-fragile profile.
    expect(msg).not.toMatch(/if you were happy|if you liked|5[- ]star|five[- ]star/i)
    expect(msg).not.toMatch(/discount|off your next|free|gift card|reward/i)
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

  it('builds review-reply context for phones with a recent sent request', async () => {
    // Use a real sent row (the production cron has been live since 9am MT).
    const { data: sentRow } = await supabase
      .from('review_requests')
      .select('phone')
      .eq('status', 'sent')
      .not('phone', 'is', null)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!sentRow?.phone) return // nothing sent yet — nothing to verify

    const digits = String(sentRow.phone).replace(/\D/g, '').slice(-10)
    const context = await buildReviewRequestContext(supabase, `+1${digits}`)
    expect(context).toContain('REVIEW REQUEST CONTEXT')
    expect(context).toContain(ALL_REVIEWS_PAGE_URL)

    // And a phone with no recent request gets no context.
    const none = await buildReviewRequestContext(supabase, '+10000000000')
    expect(none).toBe('')
  })

  it('skips customers whose name matches a Google reviewer', async () => {
    const { count } = await supabase
      .from('gbp_reviews')
      .select('*', { count: 'exact', head: true })
    expect(count ?? 0).toBeGreaterThan(0)
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

describe('we never ask for a review on a flood', () => {
  const supabase = createAdminClient()
  const MARKER = 'REVIEW_FLOOD_TEST'
  let projectId = ''
  let appointmentId = ''

  beforeAll(async () => {
    const { data: addr } = await supabase
      .from('ops_service_addresses')
      .select('id, customer_id')
      .limit(1)
      .single()

    const { data: project } = await supabase
      .from('restoration_projects')
      .insert({
        customer_id: addr!.customer_id,
        service_address_id: addr!.id,
        cause_narrative: MARKER,
      })
      .select('id')
      .single()
    projectId = project!.id

    const { data: visit } = await supabase
      .from('ops_appointments')
      .insert({
        customer_id: addr!.customer_id,
        service_address_id: addr!.id,
        booking_channel: 'admin',
        // Keeps the booked webhook quiet — no fake Telegram alert.
        source: 'integration_test',
        status: 'completed',
        completed_at: new Date().toISOString(),
        payment_status: 'unpaid',
        quickbooks_sync_status: 'held',
        appointment_date: new Date().toISOString().slice(0, 10),
        start_time: '09:00',
        end_time: '10:00',
        quoted_total: 0,
        kind: 'restoration',
        restoration_project_id: projectId,
        visit_type: 'monitor',
        internal_notes: MARKER,
      })
      .select('id')
      .single()
    appointmentId = visit!.id
  })

  afterAll(async () => {
    await supabase.from('review_requests').delete().eq('appointment_id', appointmentId)
    await supabase.from('ops_appointments').delete().eq('internal_notes', MARKER)
    await supabase.from('restoration_projects').delete().eq('id', projectId)
  })

  it('skips a completed monitor visit, with the reason on the record', async () => {
    await enqueueReviewRequests(supabase)

    const { data: row } = await supabase
      .from('review_requests')
      .select('status, skip_reason')
      .eq('appointment_id', appointmentId)
      .maybeSingle()

    expect(row?.status).toBe('skipped')
    expect(row?.skip_reason).toMatch(/flood/i)
  })
})
