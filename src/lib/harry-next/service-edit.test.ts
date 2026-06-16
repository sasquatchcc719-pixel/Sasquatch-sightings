/**
 * Replay tests for slice 1, built from the real June 16, 2026 Jamie Jones
 * failure (see docs/HARRY-REBUILD-PLAN.md). Each test pins one invariant that
 * old Harry violated. These are pure — no DB — and must stay green forever.
 */
import { describe, expect, it } from 'vitest'
import {
  jobTotal,
  planRemoveService,
  renderRemovalReply,
  type LineItem,
} from './service-edit'

// Jamie's actual job before the bad edit: 5 services totaling $378.00.
function jamiesJob(): LineItem[] {
  return [
    line('svc-step', 'Step Carpet Cleaning (Per Step Charge)', 15, 4),
    line(
      'svc-closet',
      'Hall/Bathroom/Closet Carpet cleaning 30 to 100 sqft',
      1,
      25,
    ),
    line('svc-room', 'Regular Size Room (100 to 200 Sqft)', 3, 46),
    line('svc-urine', 'Urine Eliminator Treatment', 3, 25),
    line('svc-duct', 'Dryer Duct cleaning', 1, 80),
  ]
}

function line(
  serviceCatalogItemId: string,
  nameSnapshot: string,
  quantity: number,
  unitPrice: number,
): LineItem {
  return {
    serviceCatalogItemId,
    nameSnapshot,
    quantity,
    unitPrice,
    durationMinutes: 0,
    bufferMinutes: 0,
  }
}

describe('planRemoveService — the Jamie case', () => {
  it('removes only the closet and computes the real new total ($353)', () => {
    const job = jamiesJob()
    expect(jobTotal(job)).toBe(378)

    const plan = planRemoveService(job, {
      type: 'remove_service',
      match: 'closet',
    })
    if (plan.status !== 'ok') throw new Error(`expected ok, got ${plan.status}`)

    expect(plan.removed.nameSnapshot).toContain('Closet')
    expect(plan.newTotal).toBe(353) // 378 - 25, the real figure
    expect(plan.belowMinimum).toBe(false)
  })

  it('SAYS = DOES: every other line is left byte-for-byte unchanged (no collapse)', () => {
    const job = jamiesJob()
    const plan = planRemoveService(job, {
      type: 'remove_service',
      match: 'closet',
    })
    if (plan.status !== 'ok') throw new Error('expected ok')

    // Exactly one fewer line, and the survivors are the original objects untouched.
    expect(plan.newLines).toHaveLength(job.length - 1)
    expect(plan.newLines).toEqual(
      job.filter((l) => !l.nameSnapshot.includes('Closet')),
    )
    // The Dryer Duct line is still 1 @ $80 — not 15, not collapsed onto.
    const duct = plan.newLines.find(
      (l) => l.nameSnapshot === 'Dryer Duct cleaning',
    )
    expect(duct).toMatchObject({ quantity: 1, unitPrice: 80 })
  })

  it('NO BLIND NUMBERS: the reply states the computed total and never "under $150"', () => {
    const job = jamiesJob()
    const plan = planRemoveService(job, {
      type: 'remove_service',
      match: 'closet',
    })
    if (plan.status !== 'ok') throw new Error('expected ok')

    const reply = renderRemovalReply(plan, 'Jamie')
    expect(reply).toContain('353.00') // the real total, injected by code
    expect(reply).not.toMatch(/under .*150|below .*150/i) // the lie old Harry told
    expect(reply).not.toContain('1600')
  })
})

describe('planRemoveService — safety invariants', () => {
  it('BELOW-MINIMUM HONESTY: when a removal drops under $150, it says so and asks — never pads quantities', () => {
    // Small job: one regular room ($46) + closet ($25) = $71. Remove closet -> $46.
    const job = [
      line('svc-room', 'Regular Size Room (100 to 200 Sqft)', 1, 46),
      line(
        'svc-closet',
        'Hall/Bathroom/Closet Carpet cleaning 30 to 100 sqft',
        1,
        25,
      ),
    ]
    const plan = planRemoveService(job, {
      type: 'remove_service',
      match: 'closet',
    })
    if (plan.status !== 'ok') throw new Error('expected ok')

    expect(plan.belowMinimum).toBe(true)
    expect(plan.newTotal).toBe(46)
    // Remaining line is untouched — no silent quantity inflation to clear $150.
    expect(plan.newLines).toEqual([job[0]])

    const reply = renderRemovalReply(plan, 'Jamie')
    expect(reply).toContain('150')
    expect(reply).toMatch(/add|keep/i) // asks rather than asserting it's done
    expect(reply).not.toMatch(/all set|you're set|booked/i)
  })

  it('refuses to guess on an ambiguous match — changes nothing', () => {
    const job = jamiesJob()
    const plan = planRemoveService(job, {
      type: 'remove_service',
      match: 'cleaning',
    })
    expect(plan.status).toBe('ambiguous')
  })

  it('refuses on a no-match — changes nothing', () => {
    const job = jamiesJob()
    const plan = planRemoveService(job, {
      type: 'remove_service',
      match: 'gutter',
    })
    expect(plan.status).toBe('not_found')
  })
})
