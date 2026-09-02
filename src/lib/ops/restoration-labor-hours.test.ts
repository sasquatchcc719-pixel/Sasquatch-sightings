// @vitest-environment node
/**
 * A water loss invoices once, at the close, so the single revenue entry it
 * produces carries the labour of the whole job. Reading only the closing visit
 * reported the Benns flood at roughly $2,000 an hour.
 */
import { describe, it, expect } from 'vitest'
import {
  visitLaborHours,
  MONITOR_LABOR_HOURS,
} from '@/lib/ops/restoration-labor-hours'

const visit = (v: Partial<Parameters<typeof visitLaborHours>[0]>) => ({
  visit_type: 'monitor',
  status: 'completed',
  start_time: '09:00:00',
  end_time: '11:00:00',
  on_my_way_at: null,
  completed_at: null,
  ...v,
})

describe('restoration labour, per Charles’s rule', () => {
  it('bills a monitor as one hour even though it sits in a two-hour slot', () => {
    // "each monitor was about an hour. I think we standardize a monitor to one
    // hour of labor." Monitors get dropped onto whatever slot fits the day.
    expect(visitLaborHours(visit({}))).toBe(MONITOR_LABOR_HOURS)
    expect(visitLaborHours(visit({ end_time: '17:00:00' }))).toBe(1)
  })

  it('treats the final equipment-pickup visit as a monitor', () => {
    expect(visitLaborHours(visit({ visit_type: 'final' }))).toBe(1)
  })

  it('bills the mitigation day for the hours it actually ran', () => {
    expect(
      visitLaborHours(
        visit({
          visit_type: 'mitigation',
          start_time: '09:00:00',
          end_time: '15:00:00',
        }),
      ),
    ).toBe(6)
  })

  it('adds up to the nine hours Charles said the Benns job took', () => {
    const job = [
      visit({
        visit_type: 'mitigation',
        start_time: '09:00:00',
        end_time: '15:00:00',
      }),
      visit({ start_time: '09:00:00', end_time: '11:00:00' }),
      visit({ start_time: '15:00:00', end_time: '17:00:00' }),
      visit({
        visit_type: 'final',
        start_time: '14:00:00',
        end_time: '16:00:00',
      }),
    ]
    expect(job.reduce((s, v) => s + visitLaborHours(v), 0)).toBe(9)
  })

  it('does not bill a monitor that was queued and then dropped', () => {
    expect(visitLaborHours(visit({ status: 'cancelled' }))).toBe(0)
  })
})
