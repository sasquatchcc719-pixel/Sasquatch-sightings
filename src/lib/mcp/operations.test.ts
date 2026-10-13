// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { getOperationalSummary, searchBusinessRecords } from './operations'

type Operation = { name: string; args: unknown[] }
type Resolver = (
  table: string,
  operations: Operation[],
) => { data: unknown[]; error: null }

class FixtureQuery implements PromiseLike<{ data: unknown[]; error: null }> {
  readonly operations: Operation[] = []

  constructor(
    readonly table: string,
    private readonly resolver: Resolver,
  ) {}

  private record(name: string, args: unknown[]) {
    this.operations.push({ name, args })
    return this
  }

  select(...args: unknown[]) {
    return this.record('select', args)
  }
  order(...args: unknown[]) {
    return this.record('order', args)
  }
  limit(...args: unknown[]) {
    return this.record('limit', args)
  }
  eq(...args: unknown[]) {
    return this.record('eq', args)
  }
  neq(...args: unknown[]) {
    return this.record('neq', args)
  }
  ilike(...args: unknown[]) {
    return this.record('ilike', args)
  }
  in(...args: unknown[]) {
    return this.record('in', args)
  }
  is(...args: unknown[]) {
    return this.record('is', args)
  }
  not(...args: unknown[]) {
    return this.record('not', args)
  }
  gte(...args: unknown[]) {
    return this.record('gte', args)
  }
  lte(...args: unknown[]) {
    return this.record('lte', args)
  }
  lt(...args: unknown[]) {
    return this.record('lt', args)
  }
  or(...args: unknown[]) {
    return this.record('or', args)
  }

  then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: unknown[]
          error: null
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.resolver(this.table, this.operations)).then(
      onfulfilled,
      onrejected,
    )
  }
}

function fixtureClient(resolver: Resolver) {
  const queries: FixtureQuery[] = []
  return {
    queries,
    client: {
      from(table: string) {
        const query = new FixtureQuery(table, resolver)
        queries.push(query)
        return query
      },
    },
  }
}

describe('MCP operations projections', () => {
  it('resolves customer appointments before an invoice-only name search', async () => {
    const fixture = fixtureClient((table, operations) => {
      if (table === 'ops_customers') {
        return {
          data: [
            {
              id: 'customer-1',
              full_name: 'Test Customer',
              business_name: null,
              phone: '7195550100',
              email: null,
              updated_at: '2026-10-12T12:00:00Z',
            },
          ],
          error: null,
        }
      }
      if (table === 'ops_appointments') {
        return { data: [{ id: 'appointment-1' }], error: null }
      }
      if (table === 'ops_invoices') {
        return {
          data: [
            {
              id: 'invoice-1',
              invoice_number: 101,
              appointment_id: 'appointment-1',
              status: 'sent',
              payment_status: 'unpaid',
              total: 250,
              updated_at: '2026-10-12T13:00:00Z',
            },
          ],
          error: null,
        }
      }
      return { data: [], error: null }
    })

    const result = await searchBusinessRecords(
      { query: 'Test Customer', entity: 'invoice', limit: 20 },
      fixture.client as never,
    )

    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({
      entity: 'invoice',
      id: 'invoice-1',
      app_url:
        'https://sightings.sasquatchcarpet.com/admin/operations/invoices/invoice-1',
    })
    const invoiceQuery = fixture.queries.find(
      (query) => query.table === 'ops_invoices',
    )
    expect(invoiceQuery?.operations).toContainEqual({
      name: 'in',
      args: ['appointment_id', ['appointment-1']],
    })
  })

  it('marks unread results partial when the source conversation scan is capped', async () => {
    const conversations = Array.from({ length: 501 }, (_, index) => ({
      id: `conversation-${index}`,
      phone_number: '7195550100',
      source: 'inbound',
      messages:
        index === 0
          ? [{ role: 'user', timestamp: '2026-10-12T12:00:00Z' }]
          : [],
      admin_read_at: null,
      updated_at: '2026-10-12T12:00:00Z',
    }))
    const fixture = fixtureClient((table) => ({
      data: table === 'conversations' ? conversations : [],
      error: null,
    }))

    const result = await getOperationalSummary(
      { days: 7, item_limit: 10 },
      fixture.client as never,
      new Date('2026-10-12T18:00:00Z'),
    )
    const unread = result.queues.find(
      (queue) => queue.name === 'unanswered_messages',
    )

    expect(unread).toMatchObject({
      count: 1,
      status: 'partial',
    })
    expect(unread?.note).toContain('Lower-bound count')
    expect(result.freshness.partial).toBe(true)
    expect(result.freshness.missing).toContain(
      'unanswered_messages: newest 500 source records scanned',
    )
  })

  it('limits the unpaid queue to collectible invoice workflow states', async () => {
    const fixture = fixtureClient(() => ({ data: [], error: null }))

    await getOperationalSummary(
      { days: 7, item_limit: 10 },
      fixture.client as never,
      new Date('2026-10-12T18:00:00Z'),
    )
    const invoiceQuery = fixture.queries.find(
      (query) => query.table === 'ops_invoices',
    )

    expect(invoiceQuery?.operations).toContainEqual({
      name: 'in',
      args: ['status', ['ready', 'pending', 'sent']],
    })
    expect(invoiceQuery?.operations).toContainEqual({
      name: 'or',
      args: ['payment_status.neq.paid,payment_status.is.null'],
    })
  })
})
