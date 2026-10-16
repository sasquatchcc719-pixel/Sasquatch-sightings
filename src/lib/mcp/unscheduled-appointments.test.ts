// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { listUnscheduledAppointments } from './business-operations'

type QueryResult = {
  data: Array<Record<string, unknown>>
  error: null
  count?: number
}

type Operation = { name: string; args: unknown[] }

class FixtureQuery implements PromiseLike<QueryResult> {
  readonly operations: Operation[] = []

  constructor(
    readonly table: string,
    private readonly resolver: (
      table: string,
      operations: Operation[],
    ) => QueryResult,
  ) {}

  private record(name: string, args: unknown[]) {
    this.operations.push({ name, args })
    return this
  }

  select(...args: unknown[]) {
    return this.record('select', args)
  }
  not(...args: unknown[]) {
    return this.record('not', args)
  }
  order(...args: unknown[]) {
    return this.record('order', args)
  }
  range(...args: unknown[]) {
    return this.record('range', args)
  }
  in(...args: unknown[]) {
    return this.record('in', args)
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.resolver(this.table, this.operations)).then(
      onfulfilled,
      onrejected,
    )
  }
}

describe('MCP Unscheduled appointment queue', () => {
  it('uses the UI parked criterion and returns factual conversation context without inventing eligibility', async () => {
    const queries: FixtureQuery[] = []
    const appointments = [
      {
        id: '10000000-0000-4000-8000-000000000001',
        customer_id: '20000000-0000-4000-8000-000000000001',
        appointment_date: '2026-10-24',
        start_time: '09:00:00',
        end_time: '12:00:00',
        status: 'cancelled',
        quoted_total: 500,
        kind: 'service',
        internal_notes: null,
        parked_at: '2026-10-12T19:48:30.000Z',
        created_at: '2026-09-23T15:00:00.000Z',
        updated_at: '2026-10-12T19:48:30.000Z',
        customer: {
          id: '20000000-0000-4000-8000-000000000001',
          full_name: 'Fixture Customer',
          business_name: null,
          phone: '+17195550123',
          email: 'fixture@example.com',
          email_opt_out: false,
        },
        address: {
          id: '30000000-0000-4000-8000-000000000001',
          label: 'Home',
          street_1: '123 Fixture St',
          street_2: null,
          city: 'Colorado Springs',
          state: 'CO',
          zip_code: '80903',
        },
        tech: null,
        services: [],
      },
    ]
    const conversations = [
      {
        id: '40000000-0000-4000-8000-000000000001',
        phone_number: '+17195550123',
        source: 'inbound',
        ops_customer_id: '20000000-0000-4000-8000-000000000001',
        status: 'active',
        messages: [
          {
            role: 'user',
            content: 'I need to cancel.',
            timestamp: '2026-10-12T19:40:00.000Z',
          },
          {
            role: 'assistant',
            content: 'We parked the appointment.',
            timestamp: '2026-10-12T19:48:31.000Z',
          },
          {
            role: 'user',
            content: 'I will call again soon.',
            // 20:00Z, after parking, despite sorting lexically before 19:48Z.
            timestamp: '2026-10-12T13:00:00-07:00',
          },
        ],
        created_at: '2026-09-23T15:00:00.000Z',
        updated_at: '2026-10-12T20:00:00.000Z',
      },
      {
        id: '40000000-0000-4000-8000-000000000002',
        phone_number: '+17195550123',
        source: 'inbound',
        // A phone can be reused or shared. This newer thread belongs to a
        // different customer and must never override the exact customer link.
        ops_customer_id: '20000000-0000-4000-8000-000000000099',
        status: 'active',
        messages: [
          {
            role: 'user',
            content: 'This belongs to another customer.',
            timestamp: '2026-10-12T20:10:00.000Z',
          },
        ],
        created_at: '2026-10-12T20:10:00.000Z',
        updated_at: '2026-10-12T20:10:00.000Z',
      },
    ]

    const client = {
      from(table: string) {
        const query = new FixtureQuery(table, (currentTable) => {
          if (currentTable === 'ops_appointments') {
            return { data: appointments, error: null, count: 1 }
          }
          if (currentTable === 'conversations') {
            return { data: conversations, error: null }
          }
          return { data: [], error: null }
        })
        queries.push(query)
        return query
      },
    }

    const result = await listUnscheduledAppointments(
      { limit: 50, offset: 0 },
      client as never,
    )

    expect(result.semantics).toMatchObject({
      criterion: 'ops_appointments.parked_at IS NOT NULL',
      restoration_monitor_visits_included: false,
    })
    expect(result.follow_up_tracking.available).toBe(false)
    expect(result.data[0]).toMatchObject({
      id: '10000000-0000-4000-8000-000000000001',
      queue_reason: 'parked_for_rescheduling',
      parked_at: '2026-10-12T19:48:30.000Z',
      duration_minutes: 180,
      contact_controls: {
        sms: { status: 'not_blocked_by_sightings' },
      },
      conversation: {
        id: '40000000-0000-4000-8000-000000000001',
        match_basis: 'customer_id',
        inbound_after_parking: 'yes',
        latest_inbound_message: { content: 'I will call again soon.' },
        latest_inbound_after_parking: { content: 'I will call again soon.' },
      },
      follow_up_assessment: {
        automatic_outreach_eligibility: 'not_determined',
        needs_conversation_review: true,
      },
    })

    const queueQuery = queries.find(
      (query) => query.table === 'ops_appointments',
    )
    expect(queueQuery?.operations).toContainEqual({
      name: 'not',
      args: ['parked_at', 'is', null],
    })
    expect(queueQuery?.operations).toContainEqual({
      name: 'order',
      args: ['parked_at', { ascending: true }],
    })
    expect(queueQuery?.operations).toContainEqual({
      name: 'order',
      args: ['id', { ascending: true }],
    })
    expect(queueQuery?.operations).toContainEqual({
      name: 'range',
      args: [0, 49],
    })
  })
})
