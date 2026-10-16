// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildCloseOutInvoiceBody,
  emailInvoiceOnJobCompletion,
  invoiceDueDate,
  retryInvoiceEmails,
} from './invoice-email-delivery'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  pdf: vi.fn(),
  blacklisted: vi.fn(),
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send }
  },
}))
vi.mock('@/lib/blacklist', () => ({ isBlacklisted: mocks.blacklisted }))
vi.mock('@/lib/ops/pdf/generate', () => ({ generateInvoicePDF: mocks.pdf }))
vi.mock('@/lib/ops/communications', () => ({
  buildEmailHtml: (body: string) => `<html>${body}</html>`,
}))

type Row = Record<string, unknown>
const TABLE = 'ops_invoice_email_deliveries'
const params = { appointmentId: 'appointment-1', previousStatus: 'in_progress' }

function database() {
  const customer = {
    id: 'customer-1',
    full_name: 'Charles Example',
    business_name: 'Example Restaurant',
    email: 'billing@example.com',
    phone: '7195550100',
    email_opt_out: false,
    billing_mode: 'per_visit',
    quickbooks_payment_terms_days: 45,
  }
  const appointment = {
    id: 'appointment-1',
    customer_id: customer.id,
    status: 'completed',
    kind: 'regular',
    visit_type: null as string | null,
    restoration_project_id: null as string | null,
    service_concern_id: null as string | null,
    recurring_template_id: null as string | null,
    internal_notes: '',
    appointment_date: '2026-10-15',
    ops_customers: customer,
    ops_appointment_line_items: [
      {
        name_snapshot: 'Carpet cleaning',
        service_catalog_items: { slug: 'carpet-cleaning' },
      },
    ],
    ops_service_addresses: {
      street_1: '100 Example Street',
      street_2: 'Suite 10',
      city: 'Colorado Springs',
      state: 'CO',
      zip_code: '80920',
    },
  }
  const invoice = {
    id: 'invoice-1',
    appointment_id: appointment.id,
    invoice_number: 18942,
    status: 'ready',
    payment_status: 'unpaid',
    subtotal: 1100,
    total: 1049.94,
    discount_amount: 50.06,
    percentage_discount_amount: 0,
    ops_invoice_line_items: [
      {
        description: 'Carpet cleaning',
        quantity: 1,
        unit_price: 1100,
        line_total: 1100,
        excluded_at: null,
      },
      {
        description: 'Declined work',
        quantity: 1,
        unit_price: 100,
        line_total: 100,
        excluded_at: '2026-10-15T00:00:00Z',
      },
    ],
  }
  const tables: Record<string, Row[]> = {
    ops_appointments: [appointment],
    ops_invoices: [invoice],
    ops_recurring_templates: [],
    ops_batch_invoice_entries: [],
    ops_email_log: [],
    [TABLE]: [],
  }
  let logFailures = 0
  const from = vi.fn((table: string) => {
    let operation = 'select'
    let values: Row = {}
    let conflict = 'id'
    let ignoreDuplicates = false
    let singular = false
    let returning = false
    const filters: Array<(row: Row) => boolean> = []
    const execute = () => {
      if (
        table === 'ops_email_log' &&
        operation === 'upsert' &&
        logFailures > 0
      ) {
        logFailures--
        return {
          data: null,
          error: new Error('Email audit temporarily unavailable'),
        }
      }
      const rows = tables[table] || (tables[table] = [])
      let matched = rows.filter((row) => filters.every((filter) => filter(row)))
      if (operation === 'upsert') {
        const existing = rows.find((row) => row[conflict] === values[conflict])
        if (existing) {
          if (!ignoreDuplicates) Object.assign(existing, values)
        } else {
          rows.push(
            table === TABLE
              ? {
                  id: 'delivery-1',
                  status: 'pending',
                  payload: null,
                  source_hash: null,
                  first_attempt_at: null,
                  resend_id: null,
                  sent_at: null,
                  created_at: new Date().toISOString(),
                  ...values,
                }
              : { ...values },
          )
        }
      }
      if (operation === 'update')
        matched.forEach((row) => Object.assign(row, values))
      if (operation !== 'select' && !returning)
        return { data: null, error: null }
      if (operation === 'select') {
        matched = rows.filter((row) => filters.every((filter) => filter(row)))
      }
      // Return snapshots, as PostgREST does; concurrent callers must not share row references.
      return {
        data: structuredClone(singular ? matched[0] || null : matched),
        error: null,
      }
    }
    const query = {
      select: () => {
        returning = true
        return query
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value)
        return query
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value)
        return query
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]))
        return query
      },
      update: (input: Row) => {
        operation = 'update'
        values = input
        return query
      },
      upsert: (
        input: Row,
        options?: { onConflict?: string; ignoreDuplicates?: boolean },
      ) => {
        operation = 'upsert'
        values = input
        conflict = options?.onConflict || 'id'
        ignoreDuplicates = options?.ignoreDuplicates === true
        return query
      },
      order: () => query,
      limit: () => query,
      maybeSingle: () => {
        singular = true
        return query
      },
      single: () => {
        singular = true
        return query
      },
      then: (resolve: (result: ReturnType<typeof execute>) => unknown) =>
        Promise.resolve(resolve(execute())),
    }
    return query
  })
  return {
    client: { from } as unknown as SupabaseClient,
    tables,
    appointment,
    customer,
    invoice,
    from,
    failNextLogs: (count: number) => {
      logFailures = count
    },
    delivery: () => tables[TABLE][0],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('RESEND_API_KEY', 'test-key-no-real-delivery')
  vi.stubEnv(
    'OPS_EMAIL_FROM',
    'Sasquatch Carpet Cleaning <invoices@example.com>',
  )
  vi.stubEnv('OPS_EMAIL_BCC', '')
  mocks.pdf.mockResolvedValue(Buffer.from('%PDF synthetic attachment'))
  mocks.blacklisted.mockResolvedValue(false)
  mocks.send.mockResolvedValue({ data: { id: 'provider-1' }, error: null })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('invoice due date and check instructions', () => {
  it('uses calendar days for Net 45 through month/year boundaries', () => {
    expect(invoiceDueDate('2026-10-15', 45)).toBe('2026-11-29')
    expect(invoiceDueDate('2026-12-15', 45)).toBe('2027-01-29')
    expect(invoiceDueDate('2028-02-15', 14)).toBe('2028-02-29')
    expect(invoiceDueDate('2026-10-15', 0)).toBe('2026-10-15')
    expect(invoiceDueDate('2026-10-15', null)).toBeNull()
    expect(invoiceDueDate('2026-10-15', -1)).toBeNull()
    expect(invoiceDueDate('2026-10-15', 1.5)).toBeNull()
    expect(() => invoiceDueDate('invalid-date', 45)).toThrow(
      'Invalid service date',
    )
  })

  it('states check payee, address, invoice memo and optional actual due date', () => {
    const body = buildCloseOutInvoiceBody({
      customerName: 'Example Restaurant',
      invoiceNumber: 18942,
      serviceAddress: '100 Example Street',
      serviceDate: '2026-10-15',
      total: 1049.94,
      dueDate: '2026-11-29',
    })
    expect(body).toContain('itemized invoice #18942 is attached')
    expect(body).toContain('Total due: $1049.94')
    expect(body).toContain('Payment due: 2026-11-29')
    expect(body).toContain('checks payable to Sasquatch Carpet Cleaning')
    expect(body).toContain('PO Box 1651, Palmer Lake, CO 80133')
    expect(body).toContain('Include invoice #18942 on the memo line.')
    expect(
      buildCloseOutInvoiceBody({
        customerName: 'Example',
        invoiceNumber: 1,
        serviceAddress: 'Example',
        serviceDate: '2026-10-15',
        total: 50,
        dueDate: null,
      }),
    ).not.toContain('Payment due:')
  })
})

describe('close-out invoice email delivery', () => {
  it('sends one itemized PDF with actual invoice number, check address and Net 45', async () => {
    const db = database()
    expect(await emailInvoiceOnJobCompletion(db.client, params)).toBe('sent')
    expect(mocks.pdf).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceNumber: 18942,
        dueDate: '2026-11-29',
        isPaid: false,
        discountAmount: 50.06,
        total: 1049.94,
        lineItems: [
          expect.objectContaining({ description: 'Carpet cleaning' }),
        ],
      }),
    )
    const [payload, options] = mocks.send.mock.calls[0]
    expect(payload.to).toBe('billing@example.com')
    expect(payload.subject).toContain('Invoice #18942')
    expect(payload.text).toContain('PO Box 1651, Palmer Lake, CO 80133')
    expect(payload.html).toContain('Payment due: 2026-11-29')
    expect(payload.attachments).toEqual([
      {
        filename: 'Invoice-18942.pdf',
        content: Buffer.from('%PDF synthetic attachment').toString('base64'),
      },
    ])
    expect(options).toEqual({ idempotencyKey: 'invoice-close-invoice-1' })
    expect(db.delivery()).toMatchObject({
      status: 'sent',
      resend_id: 'provider-1',
      payload: null,
    })
    expect(db.tables.ops_email_log[0]).toMatchObject({
      status: 'sent',
      resend_id: 'provider-1',
      to_email: 'billing@example.com',
    })
  })

  it.each([
    { previousStatus: 'completed' },
    { skipCustomerCommunications: true },
  ])(
    'does not enqueue quiet or previously completed jobs: %j',
    async (override) => {
      const db = database()
      expect(
        await emailInvoiceOnJobCompletion(db.client, {
          ...params,
          ...override,
        }),
      ).toBe('skipped')
      expect(db.from).not.toHaveBeenCalled()
      expect(mocks.send).not.toHaveBeenCalled()
    },
  )

  it.each([
    [
      'estimate',
      (db: ReturnType<typeof database>) => {
        db.appointment.kind = 'estimate'
      },
    ],
    [
      'restoration',
      (db: ReturnType<typeof database>) => {
        db.appointment.kind = 'restoration'
      },
    ],
    [
      'restoration visit',
      (db: ReturnType<typeof database>) => {
        db.appointment.visit_type = 'monitor'
      },
    ],
    [
      'restoration project',
      (db: ReturnType<typeof database>) => {
        db.appointment.restoration_project_id = 'project'
      },
    ],
    [
      'warranty concern',
      (db: ReturnType<typeof database>) => {
        db.appointment.service_concern_id = 'concern'
      },
    ],
    [
      'warranty catalog service',
      (db: ReturnType<typeof database>) => {
        db.appointment.ops_appointment_line_items[0].service_catalog_items.slug =
          'warranty-re-clean'
      },
    ],
    [
      'monthly customer',
      (db: ReturnType<typeof database>) => {
        db.customer.billing_mode = 'monthly_consolidated'
      },
    ],
    [
      'monthly recurring',
      (db: ReturnType<typeof database>) => {
        db.appointment.recurring_template_id = 'template'
        db.tables.ops_recurring_templates.push({
          id: 'template',
          invoice_mode: 'batch_monthly',
        })
      },
    ],
    [
      'existing batch entry',
      (db: ReturnType<typeof database>) => {
        db.tables.ops_batch_invoice_entries.push({
          id: 'batch-entry',
          appointment_id: 'appointment-1',
        })
      },
    ],
    [
      'paid status',
      (db: ReturnType<typeof database>) => {
        db.invoice.status = 'paid'
      },
    ],
    [
      'paid payment status',
      (db: ReturnType<typeof database>) => {
        db.invoice.payment_status = 'paid'
      },
    ],
    [
      'waived',
      (db: ReturnType<typeof database>) => {
        db.invoice.payment_status = 'waived'
      },
    ],
    [
      'zero total',
      (db: ReturnType<typeof database>) => {
        db.invoice.total = 0
      },
    ],
    [
      'opted out',
      (db: ReturnType<typeof database>) => {
        db.customer.email_opt_out = true
      },
    ],
    [
      'test suppression marker',
      (db: ReturnType<typeof database>) => {
        db.appointment.internal_notes = 'TEMP_SUPPRESS_CUSTOMER_COMMS_TEST'
      },
    ],
    [
      'not actually completed',
      (db: ReturnType<typeof database>) => {
        db.appointment.status = 'in_progress'
      },
    ],
  ] as const)('skips %s without customer delivery', async (_name, setup) => {
    const db = database()
    setup(db)
    expect(await emailInvoiceOnJobCompletion(db.client, params)).toBe('skipped')
    expect(mocks.send).not.toHaveBeenCalled()
    expect(db.tables[TABLE]).toHaveLength(0)
  })

  it('suppresses blacklisted customers', async () => {
    const db = database()
    mocks.blacklisted.mockResolvedValue(true)
    expect(await emailInvoiceOnJobCompletion(db.client, params)).toBe('skipped')
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it.each(['', 'not-an-email', 'imported@import.local'])(
    'never sends to invalid or missing email %j',
    async (email) => {
      const db = database()
      db.customer.email = email
      expect(await emailInvoiceOnJobCompletion(db.client, params)).toBe(
        'failed',
      )
      expect(mocks.send).not.toHaveBeenCalled()
      expect(db.tables.ops_email_log.some((row) => row.status === 'sent')).toBe(
        false,
      )
      expect(db.delivery()).toMatchObject({ status: 'failed', resend_id: null })
    },
  )

  it('does not send without the required PDF and records a retryable failure', async () => {
    const db = database()
    mocks.pdf.mockResolvedValue(null)
    expect(await emailInvoiceOnJobCompletion(db.client, params)).toBe('failed')
    expect(mocks.send).not.toHaveBeenCalled()
    expect(db.delivery()).toMatchObject({ status: 'failed', resend_id: null })
    expect(db.tables.ops_email_log[0].status).toBe('failed')
  })

  it.each([
    { data: null, error: { message: 'Provider rejected invoice' } },
    { data: {}, error: null },
  ])(
    'does not mark sent when provider has not accepted: %j',
    async (result) => {
      const db = database()
      mocks.send.mockResolvedValue(result)
      expect(await emailInvoiceOnJobCompletion(db.client, params)).toBe(
        'failed',
      )
      expect(db.delivery()).toMatchObject({ status: 'failed', resend_id: null })
      expect(db.tables.ops_email_log[0].status).toBe('failed')
    },
  )

  it('does not resend an accepted invoice on repeated close or retry scans', async () => {
    const db = database()
    await emailInvoiceOnJobCompletion(db.client, params)
    await emailInvoiceOnJobCompletion(db.client, params)
    expect(await retryInvoiceEmails(db.client)).toEqual([])
    expect(db.tables[TABLE]).toHaveLength(1)
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('freezes one payload and stable provider key across concurrent closes', async () => {
    const db = database()
    const accepted = new Map<string, string>()
    mocks.send.mockImplementation(async (payload, options) => {
      const encoded = JSON.stringify(payload)
      const previous = accepted.get(options.idempotencyKey)
      if (previous && previous !== encoded)
        throw new Error('Idempotency payload changed')
      accepted.set(options.idempotencyKey, encoded)
      await Promise.resolve()
      return { data: { id: 'provider-1' }, error: null }
    })
    const results = await Promise.all([
      emailInvoiceOnJobCompletion(db.client, params),
      emailInvoiceOnJobCompletion(db.client, params),
    ])
    expect(results).toEqual(['sent', 'sent'])
    expect(db.tables[TABLE]).toHaveLength(1)
    expect(accepted.size).toBe(1)
    expect(db.delivery()).toMatchObject({
      status: 'sent',
      resend_id: 'provider-1',
    })
    for (const [payload, options] of mocks.send.mock.calls) {
      expect(payload).not.toBeNull()
      expect(options.idempotencyKey).toBe('invoice-close-invoice-1')
    }
  })

  it('does not prepare or send a second PDF after a concurrent close already finished', async () => {
    const db = database()
    let releaseSecondPdf!: () => void
    let secondPdfStarted!: () => void
    const secondStarted = new Promise<void>((resolve) => {
      secondPdfStarted = resolve
    })
    const secondGate = new Promise<void>((resolve) => {
      releaseSecondPdf = resolve
    })
    mocks.pdf
      .mockResolvedValueOnce(Buffer.from('%PDF first frozen attachment'))
      .mockImplementationOnce(async () => {
        secondPdfStarted()
        await secondGate
        return Buffer.from('%PDF different rendering bytes')
      })

    const firstClose = emailInvoiceOnJobCompletion(db.client, params)
    const secondClose = emailInvoiceOnJobCompletion(db.client, params)
    await secondStarted
    expect(await firstClose).toBe('sent')
    releaseSecondPdf()
    expect(await secondClose).toBe('sent')

    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(db.delivery()).toMatchObject({
      status: 'sent',
      resend_id: 'provider-1',
      payload: null,
    })
  })

  it('retries the exact frozen attachment with the original provider key', async () => {
    const db = database()
    mocks.send.mockResolvedValueOnce({
      data: null,
      error: { message: 'Temporary rejection' },
    })
    expect(await emailInvoiceOnJobCompletion(db.client, params)).toBe('failed')
    expect(await retryInvoiceEmails(db.client)).toEqual(['sent'])
    expect(mocks.pdf).toHaveBeenCalledTimes(1)
    expect(mocks.send.mock.calls[1]).toEqual(mocks.send.mock.calls[0])
    expect(db.delivery()).toMatchObject({
      status: 'sent',
      resend_id: 'provider-1',
    })
  })

  it('repairs a failed audit after provider acceptance without another send', async () => {
    const db = database()
    db.failNextLogs(1)
    expect(await emailInvoiceOnJobCompletion(db.client, params)).toBe('failed')
    expect(db.delivery()).toMatchObject({
      status: 'failed',
      resend_id: 'provider-1',
    })
    expect(await retryInvoiceEmails(db.client)).toEqual(['sent'])
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(db.tables.ops_email_log[0]).toMatchObject({
      status: 'sent',
      resend_id: 'provider-1',
    })
  })

  it('requires review instead of resending if invoice or recipient changes after preparation', async () => {
    const db = database()
    mocks.send.mockResolvedValueOnce({
      data: null,
      error: { message: 'Temporary rejection' },
    })
    expect(await emailInvoiceOnJobCompletion(db.client, params)).toBe('failed')
    const frozen = structuredClone(db.delivery().payload)
    db.customer.email = 'new-billing@example.com'
    expect(await retryInvoiceEmails(db.client)).toEqual(['review'])
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(db.delivery().payload).toEqual(frozen)
  })

  it('requires review after the safe retry horizon instead of sending an old invoice', async () => {
    const db = database()
    mocks.send.mockResolvedValueOnce({
      data: null,
      error: { message: 'Temporary rejection' },
    })
    await emailInvoiceOnJobCompletion(db.client, params)
    db.delivery().first_attempt_at = new Date(
      Date.now() - 24 * 60 * 60 * 1000,
    ).toISOString()
    expect(await retryInvoiceEmails(db.client)).toEqual(['review'])
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(db.delivery().status).toBe('review')
  })
})
