// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  access: vi.fn(),
  appointment: vi.fn(),
  baseline: vi.fn(),
  telegram: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
vi.mock('@/lib/tech/appointments', () => ({
  getAssignedTechAppointment: mocks.appointment,
  getTechAppointmentForAccess: mocks.appointment,
  shouldHideTechPricing: () => false,
}))
vi.mock('@/lib/ops/add-on-bonuses', () => ({
  captureAddOnBonusBaseline: mocks.baseline,
}))
vi.mock('@/lib/telegram', () => ({ sendTelegramNotification: mocks.telegram }))
import { PATCH } from './invoice/route'
import { POST } from './exclude-line/route'
type Row = Record<string, unknown>
let tables: Record<string, Row[]>,
  writes: Array<{ table: string; operation: string }>,
  failure: string
class Query {
  operation = 'read'
  values: Row[] = []
  filters: Array<(row: Row) => boolean> = []
  columns = ''
  constructor(readonly table: string) {}
  select(columns = '') {
    this.columns = columns
    return this
  }
  eq(key: string, value: unknown) {
    this.filters.push((row) => row[key] === value)
    return this
  }
  in(key: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[key]))
    return this
  }
  order() {
    return this
  }
  update(values: Row) {
    this.operation = 'update'
    this.values = [values]
    return this
  }
  insert(values: Row | Row[]) {
    this.operation = 'insert'
    this.values = Array.isArray(values) ? values : [values]
    return this
  }
  delete() {
    this.operation = 'delete'
    return this
  }
  execute() {
    const rows = tables[this.table] || [],
      matches = rows.filter((row) =>
        this.filters.every((filter) => filter(row)),
      )
    if (this.operation !== 'read') {
      writes.push({ table: this.table, operation: this.operation })
      if (failure === this.table + ':' + this.operation)
        return { data: null, error: new Error('synthetic write failure') }
      if (this.operation === 'delete')
        tables[this.table] = rows.filter((row) => !matches.includes(row))
      if (this.operation === 'update')
        matches.forEach((row) => Object.assign(row, this.values[0]))
      if (this.operation === 'insert') {
        const added = this.values.map((row, index) => ({
          id: 'new-' + rows.length + '-' + index,
          ...row,
        }))
        rows.push(...added)
        tables[this.table] = rows
        return { data: structuredClone(added), error: null }
      }
    }
    const data = structuredClone(matches).map((row) => {
      if (
        this.table === 'ops_appointments' &&
        this.columns.includes('ops_invoices')
      )
        row.ops_invoices = structuredClone(tables.ops_invoices)
      if (
        this.table === 'ops_invoices' &&
        this.columns.includes('ops_invoice_line_items')
      )
        row.ops_invoice_line_items = structuredClone(
          tables.ops_invoice_line_items,
        )
      return row
    })
    return { data, error: null }
  }
  async single() {
    const result = this.execute()
    return { ...result, data: result.data?.[0] ?? null }
  }
  maybeSingle() {
    return this.single()
  }
  then(resolve: (result: ReturnType<Query['execute']>) => unknown) {
    return Promise.resolve(this.execute()).then(resolve)
  }
}
const context = { params: Promise.resolve({ id: 'job' }) }
function request(body: Row) {
  return new NextRequest('http://localhost/synthetic', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
function edit(price: number) {
  return PATCH(
    request({
      line_items: [
        { id: 'line', name: 'Carpet', quantity: 1, unitPrice: price },
      ],
    }),
    context,
  )
}
function exclude() {
  return POST(
    request({ lineItemId: 'line', reason: 'Customer removed this work' }),
    context,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  writes = []
  failure = ''
  mocks.access.mockResolvedValue({
    id: 'owner',
    role: 'owner',
    staff: { id: 'tech', display_name: 'Owner' },
  })
  mocks.baseline.mockResolvedValue(undefined)
  mocks.telegram.mockResolvedValue(true)
  tables = {
    ops_appointments: [
      { id: 'job', assigned_staff_user_id: 'tech', quoted_total: 565 },
    ],
    ops_appointment_line_items: [
      {
        id: 'line',
        appointment_id: 'job',
        service_catalog_item_id: 'carpet',
        name_snapshot: 'Carpet',
        quantity: 2,
        unit_price: 300,
        line_total: 600,
      },
    ],
    ops_invoices: [
      {
        id: 'invoice',
        appointment_id: 'job',
        subtotal: 600,
        total: 565,
        discount_amount: 35,
        discount_metadata: {
          promo: { code: 'TF35', amount: 35 },
          gap_offer: { minimum_service_cents: 30000 },
        },
      },
    ],
    ops_invoice_line_items: [
      {
        id: 'invoice-line',
        invoice_id: 'invoice',
        appointment_line_item_id: 'line',
        description: 'Carpet',
        quantity: 2,
        unit_price: 300,
        line_total: 600,
      },
    ],
    service_catalog_items: [
      {
        id: 'carpet',
        name: 'Carpet',
        category: 'Carpet Cleaning',
        slug: 'carpet',
        is_active: true,
      },
    ],
  }
  mocks.db.mockReturnValue({ from: (table: string) => new Query(table) })
  mocks.appointment.mockImplementation(async () => ({
    id: 'job',
    customerName: 'Synthetic Customer',
    hidePricing: false,
    fiberChecks: [],
    lineItems: tables.ops_appointment_line_items.map((row) => ({
      id: row.id,
      name: row.name_snapshot,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      lineTotal: row.line_total,
      requiresFiberCheck: false,
      excludedAt: row.excluded_at,
      excludedOriginalTotal: row.excluded_original_total,
    })),
  }))
})
describe('TF35 invoice routes using disposable in-memory records', () => {
  it('rejects a below-minimum edit before bonus capture or financial writes', async () => {
    expect((await edit(299.99)).status).toBe(400)
    expect(writes).toEqual([])
    expect(mocks.baseline).not.toHaveBeenCalled()
  })
  it('keeps the retained-offer quote and invoice at $265 for exactly $300 services', async () => {
    expect((await edit(300)).status).toBe(200)
    expect(tables.ops_invoices[0]).toMatchObject({
      subtotal: 300,
      total: 265,
      discount_amount: 35,
    })
    expect(tables.ops_appointments[0].quoted_total).toBe(265)
    expect(tables.ops_invoice_line_items).toHaveLength(1)
  })
  it('does not insert duplicate invoice lines after their deletion fails', async () => {
    failure = 'ops_invoice_line_items:delete'
    expect((await edit(300)).status).toBe(500)
    expect(
      writes.filter((row) => row.table === 'ops_invoice_line_items'),
    ).toEqual([{ table: 'ops_invoice_line_items', operation: 'delete' }])
    expect(tables.ops_invoice_line_items).toHaveLength(1)
    expect(tables.ops_appointments[0].quoted_total).toBe(565)
  })
  it('splits one removed piece, preserves its exclusion evidence, and retains $35 at $300', async () => {
    expect((await exclude()).status).toBe(200)
    expect(tables.ops_appointment_line_items).toHaveLength(2)
    expect(tables.ops_appointment_line_items[1]).toMatchObject({
      line_total: 0,
      excluded_original_total: 300,
    })
    expect(tables.ops_invoice_line_items).toHaveLength(2)
    expect(tables.ops_invoices[0]).toMatchObject({ subtotal: 300, total: 265 })
    expect(tables.ops_appointments[0].quoted_total).toBe(265)
  })
  it('rejects exclusion below $300 before baseline, writes or owner notification', async () => {
    tables.ops_appointment_line_items[0].quantity = 1
    tables.ops_appointment_line_items[0].line_total = 300
    tables.ops_invoice_line_items[0].quantity = 1
    tables.ops_invoice_line_items[0].line_total = 300
    expect((await exclude()).status).toBe(400)
    expect(writes).toEqual([])
    expect(mocks.baseline).not.toHaveBeenCalled()
    expect(mocks.telegram).not.toHaveBeenCalled()
  })
  it.each(['edit', 'exclude'])(
    'surfaces final invoice persistence failure during %s without claiming a saved quote',
    async (flow) => {
      failure = 'ops_invoices:update'
      expect((await (flow === 'edit' ? edit(300) : exclude())).status).toBe(500)
      expect(tables.ops_invoices[0].total).toBe(565)
      expect(tables.ops_appointments[0].quoted_total).toBe(565)
      expect(mocks.telegram).not.toHaveBeenCalled()
      // Legacy line writes are multiple requests; this does not assert full rollback.
    },
  )
})
