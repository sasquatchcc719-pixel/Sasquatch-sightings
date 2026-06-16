import { describe, expect, it } from 'vitest'
import { planRemovalExecution, type ExistingAppointmentLine } from './executor'
import { recomputeEndTime } from './schedule'

// Jamie's real job, as database rows with ids. Start time 2:00 PM.
function jamieRows(): ExistingAppointmentLine[] {
  return [
    row(
      'row-step',
      'svc-step',
      'Step Carpet Cleaning (Per Step Charge)',
      15,
      4,
    ),
    row(
      'row-closet',
      'svc-closet',
      'Hall/Bathroom/Closet Carpet cleaning 30 to 100 sqft',
      1,
      25,
    ),
    row('row-room', 'svc-room', 'Regular Size Room (100 to 200 Sqft)', 3, 46),
    row('row-urine', 'svc-urine', 'Urine Eliminator Treatment', 3, 25),
    row('row-duct', 'svc-duct', 'Dryer Duct cleaning', 1, 80),
  ]
}

function row(
  id: string,
  serviceCatalogItemId: string,
  nameSnapshot: string,
  quantity: number,
  unitPrice: number,
): ExistingAppointmentLine {
  return {
    id,
    serviceCatalogItemId,
    nameSnapshot,
    quantity,
    unitPrice,
    durationMinutes: 0,
    bufferMinutes: 0,
  }
}

describe('planRemovalExecution — the Jamie case, end to end (pure)', () => {
  it('targets exactly the closet row id and recomputes total + end time', () => {
    const exec = planRemovalExecution({
      startTime: '14:00:00',
      appointmentLines: jamieRows(),
      intent: { type: 'remove_service', match: 'closet' },
    })
    if (exec.status !== 'ready')
      throw new Error(`expected ready, got ${exec.status}`)

    // Deletes one specific row — the closet — by id.
    expect(exec.deleteAppointmentLineItemId).toBe('row-closet')
    // The four survivors keep their ids and values; nothing collapsed.
    expect(exec.keptLines.map((l) => l.id)).toEqual([
      'row-step',
      'row-room',
      'row-urine',
      'row-duct',
    ])
    expect(exec.newQuotedTotal).toBe(353)
    expect(exec.belowMinimum).toBe(false)
    // End time matches the real $353 tier, NOT the corrupted $1,600 (4-hour) one.
    expect(exec.newEndTime).toBe(recomputeEndTime('14:00', 353))
    expect(exec.newEndTime < recomputeEndTime('14:00', 1600)).toBe(true)
  })

  it('passes ambiguous / not-found through so the executor never writes', () => {
    const ambiguous = planRemovalExecution({
      startTime: '14:00:00',
      appointmentLines: jamieRows(),
      intent: { type: 'remove_service', match: 'cleaning' },
    })
    expect(ambiguous.status).toBe('ambiguous')

    const missing = planRemovalExecution({
      startTime: '14:00:00',
      appointmentLines: jamieRows(),
      intent: { type: 'remove_service', match: 'gutter' },
    })
    expect(missing.status).toBe('not_found')
  })
})
