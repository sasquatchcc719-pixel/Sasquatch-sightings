import { describe, expect, it } from 'vitest'
import { computeRetention } from './business-health'

const job = (
  customer_id: string,
  appointment_date: string,
  revenue: number,
  customer_name = `Customer ${customer_id}`,
) => ({ customer_id, customer_name, appointment_date, revenue })

describe('computeRetention', () => {
  it('computes repeat rate, revenue share, and average value', () => {
    const r = computeRetention(
      [
        job('a', '2026-04-10', 300),
        job('a', '2026-06-20', 350),
        job('b', '2026-05-01', 500),
        job('c', '2026-05-15', 200),
      ],
      '2026-07-14',
    )
    expect(r.customers).toBe(3)
    expect(r.repeatCustomers).toBe(1)
    expect(r.repeatRatePct).toBe(33.3)
    expect(r.repeatRevenue).toBe(650)
    expect(r.totalRevenue).toBe(1350)
    expect(r.avgCustomerValue).toBe(450)
    expect(r.sinceDate).toBe('2026-04-10')
  })

  it('treats same-day appointments as one visit', () => {
    const r = computeRetention(
      [job('a', '2026-05-01', 300), job('a', '2026-05-01', 100)],
      '2026-07-14',
    )
    expect(r.repeatCustomers).toBe(0)
    expect(r.customers).toBe(1)
  })

  it('computes median days between visits from repeat customers', () => {
    const r = computeRetention(
      [
        job('a', '2026-01-01', 100),
        job('a', '2026-03-02', 100), // 60-day gap
        job('b', '2026-01-01', 100),
        job('b', '2026-04-11', 100), // 100-day gap
      ],
      '2026-07-14',
    )
    expect(r.medianDaysBetweenVisits).toBe(80)
  })

  it('buckets due-soon (3–6mo) and overdue (6mo+) by last service', () => {
    const r = computeRetention(
      [
        job('fresh', '2026-06-20', 100),
        job('due', '2026-03-01', 400), // ~4.4 months
        job('overdue', '2025-12-01', 900), // ~7.4 months
      ],
      '2026-07-14',
    )
    expect(r.dueSoonCount).toBe(1)
    expect(r.overdueCount).toBe(1)
    // Sorted by lifetime value: overdue ($900) first
    expect(r.dueList[0].customerId).toBe('overdue')
    expect(r.dueList[0].monthsSince).toBeGreaterThan(6)
    expect(r.dueList[1].customerId).toBe('due')
    expect(r.dueList.some((d) => d.customerId === 'fresh')).toBe(false)
  })

  it('handles empty input', () => {
    const r = computeRetention([], '2026-07-14')
    expect(r.customers).toBe(0)
    expect(r.repeatRatePct).toBe(0)
    expect(r.medianDaysBetweenVisits).toBeNull()
    expect(r.dueList).toEqual([])
  })

  it('counts HCP customer who booked an ops job as a cross-system repeat', () => {
    const r = computeRetention(
      [job('ops-1', '2026-05-01', 300, 'Alex')],
      '2026-07-14',
      {
        hcp: [
          {
            hcp_id: 'h1',
            customer_name: 'Alex',
            last_service_date_hcp: '2025-05-01',
            lifetime_value: 900,
            ops_customer_id: 'ops-1',
            do_not_contact: false,
          },
        ],
      },
    )
    expect(r.customers).toBe(1)
    expect(r.repeatCustomers).toBe(1)
    expect(r.crossSystemRepeats).toBe(1)
    expect(r.totalRevenue).toBe(1200) // ops 300 + hcp 900
    expect(r.medianDaysBetweenVisits).toBe(365)
  })

  it('adds HCP-only customers with a date to the universe and due list', () => {
    const r = computeRetention([], '2026-07-14', {
      hcp: [
        {
          hcp_id: 'h2',
          customer_name: 'Old HCP Customer',
          last_service_date_hcp: '2025-09-01',
          lifetime_value: 500,
          ops_customer_id: null,
          do_not_contact: false,
        },
        {
          hcp_id: 'h3',
          customer_name: 'Contact Only',
          last_service_date_hcp: null,
          lifetime_value: 0,
          ops_customer_id: null,
          do_not_contact: false,
        },
      ],
    })
    expect(r.customers).toBe(1) // dateless contact excluded
    expect(r.overdueCount).toBe(1)
    expect(r.dueList[0].name).toBe('Old HCP Customer')
    expect(r.dueList[0].lifetimeValue).toBe(500)
  })

  it('excludes do-not-contact and currently-booked customers from the due list', () => {
    const r = computeRetention(
      [job('booked-cust', '2026-03-01', 300, 'Booked')],
      '2026-07-14',
      {
        hcp: [
          {
            hcp_id: 'h4',
            customer_name: 'DNC Customer',
            last_service_date_hcp: '2025-01-01',
            lifetime_value: 400,
            ops_customer_id: null,
            do_not_contact: true,
          },
        ],
        bookedCustomerIds: new Set(['booked-cust']),
      },
    )
    expect(r.dueList).toEqual([])
    expect(r.customers).toBe(2) // both still count as customers
  })
})
