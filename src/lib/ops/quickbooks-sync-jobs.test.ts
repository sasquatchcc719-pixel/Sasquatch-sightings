import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdminClient } from '@/supabase/server'
vi.mock('@/lib/quickbooks-api', () => ({
  excludeCashInvoiceFromQuickBooks: vi.fn(async () => false),
}))
vi.mock('@/lib/quickbooks', () => ({
  getQuickBooksSyncStatus: () => 'pending',
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: vi.fn() }))
import {
  ensureInvoiceQuickBooksSyncJob,
  resumeQuickBooksAuthorizationJobs,
} from './quickbooks-sync-jobs'

let job: Record<string, any>
let recoveryFilter = ''
const db = {
  from: (table: string) => {
    let patch: Record<string, unknown> | null = null
    const finish = () => {
      if (patch && table === 'ops_quickbooks_sync_jobs')
        Object.assign(job, patch)
      return {
        data:
          table === 'ops_invoices'
            ? {
                id: 'invoice',
                status: 'paid',
                payment_method: 'square',
                quickbooks_invoice_id: null,
                ops_appointments: { kind: 'service' },
              }
            : [{ id: job.id }],
        error: null,
      }
    }
    const q: any = {
      select: () => q,
      eq: () => q,
      in: () => q,
      order: () => q,
      or: (s: string) => {
        recoveryFilter = s
        return q
      },
      update: (p: Record<string, unknown>) => {
        patch = p
        return q
      },
      maybeSingle: async () => finish(),
      then: (resolve: any, reject: any) =>
        Promise.resolve(finish()).then(resolve, reject),
    }
    return q
  },
} as unknown as ReturnType<typeof createAdminClient>

beforeEach(() => {
  job = {
    id: 'old-job',
    status: 'failed',
    sync_attempts: 6,
    next_retry_at: '2099-01-01T00:00:00Z',
    alerted_at: '2026-10-20T12:00:00Z',
  }
  recoveryFilter = ''
})
describe('QuickBooks job recovery', () => {
  it('gives an individual invoice retry a fresh attempt ladder immediately', async () => {
    await ensureInvoiceQuickBooksSyncJob(db, 'invoice')
    expect(job).toMatchObject({
      status: 'pending',
      sync_attempts: 0,
      next_retry_at: null,
      alerted_at: null,
    })
  })
  it('does not endlessly rearm new non-revocation token failures in the cron', async () => {
    await resumeQuickBooksAuthorizationJobs(db)
    expect(recoveryFilter).toContain(
      'error_message.eq.QB token refresh failed: 400',
    )
    expect(recoveryFilter).not.toContain(
      'error_message.like.QB token refresh failed:%',
    )
  })
  it('rearms all authorization failures after an explicit successful reconnect', async () => {
    await resumeQuickBooksAuthorizationJobs(db, true)
    expect(recoveryFilter).toContain(
      'error_message.like.QB token refresh failed:%',
    )
    expect(job).toMatchObject({
      status: 'pending',
      sync_attempts: 0,
      next_retry_at: null,
      alerted_at: null,
    })
  })
})
