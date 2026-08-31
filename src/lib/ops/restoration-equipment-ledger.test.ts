import { describe, it, expect } from 'vitest'
import {
  unitDays,
  equipmentLedger,
  ledgerAsOf,
  placementsAsOf,
} from './restoration-equipment-ledger'

const NOW = new Date('2026-08-31T23:45:00Z')

describe('unitDays', () => {
  it('charges a day for equipment set down and pulled the same afternoon', () => {
    // It still cost a day's rental and a trip.
    expect(unitDays('2026-08-31T15:37:00Z', '2026-08-31T21:05:00Z', NOW)).toBe(1)
  })

  it('gives an hour of grace so three days and ten minutes is three', () => {
    expect(unitDays('2026-08-28T09:00:00Z', '2026-08-31T09:10:00Z', NOW)).toBe(3)
  })

  it('charges the fourth day once it is properly into it', () => {
    expect(unitDays('2026-08-28T09:00:00Z', '2026-08-31T11:00:00Z', NOW)).toBe(4)
  })

  it('keeps counting while a unit is still running', () => {
    expect(unitDays('2026-08-29T09:00:00Z', null, NOW)).toBe(3)
  })
})

describe('equipmentLedger', () => {
  // Charles's actual job: eight fans placed together, two pulled hours later.
  const placements = [
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `run-${i}`,
      catalog_code: 'DRY',
      placed_at: '2026-08-31T15:37:00Z',
      removed_at: null,
    })),
    ...Array.from({ length: 2 }, (_, i) => ({
      id: `pulled-${i}`,
      catalog_code: 'DRY',
      placed_at: '2026-08-31T15:37:00Z',
      removed_at: '2026-08-31T21:05:00Z',
    })),
    {
      id: 'dehu',
      catalog_code: 'DHM>>',
      placed_at: '2026-08-31T15:37:00Z',
      removed_at: null,
    },
  ]

  it('separates what is running from what has been billed', () => {
    const [fans] = equipmentLedger(placements, NOW).filter((l) => l.code === 'DRY')
    expect(fans.running).toBe(6)
    expect(fans.pulled).toBe(2)
    // The two pulled fans still ran today, so eight days are owed.
    expect(fans.unitDays).toBe(8)
  })

  it('keeps billing a pulled unit for the days it ran', () => {
    // The heart of Charles's complaint: pulling two dropped the running count
    // and left the money alone. That is correct, and had to be visible.
    const before = equipmentLedger(
      placements.map((p) => ({ ...p, removed_at: null })),
      NOW,
    ).find((l) => l.code === 'DRY')!
    const after = equipmentLedger(placements, NOW).find((l) => l.code === 'DRY')!
    expect(after.unitDays).toBe(before.unitDays)
    expect(after.running).toBeLessThan(before.running)
  })

  it('lists every unit so the total can be checked', () => {
    const [fans] = equipmentLedger(placements, NOW).filter((l) => l.code === 'DRY')
    expect(fans.units).toHaveLength(8)
    expect(fans.units.reduce((sum, u) => sum + u.days, 0)).toBe(fans.unitDays)
  })

  it('keeps each kind of equipment apart', () => {
    const codes = equipmentLedger(placements, NOW).map((l) => l.code).sort()
    expect(codes).toEqual(['DHM>>', 'DRY'])
  })
})

describe('what the equipment had cost on a given day', () => {
  const placements = [
    { id: 'a', catalog_code: 'DRY', placed_at: '2026-08-29T15:00:00Z', removed_at: null },
    { id: 'b', catalog_code: 'DRY', placed_at: '2026-08-31T15:00:00Z', removed_at: null },
  ]
  const now = new Date('2026-09-02T18:00:00Z')

  it('climbs day by day, which is the shape of a drying job', () => {
    const days = ['2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01'].map((day) => {
      const asOf = ledgerAsOf(day, now)
      const [line] = equipmentLedger(placementsAsOf(placements, asOf), asOf)
      return line?.unitDays ?? 0
    })
    // One fan for one day, then two, then two fans across two and one days...
    expect(days).toEqual([1, 2, 4, 6])
    // Strictly increasing: a monitor day always costs more than the one before.
    for (let i = 1; i < days.length; i++) {
      expect(days[i]).toBeGreaterThan(days[i - 1])
    }
  })

  it('counts nothing on a day before the equipment was set down', () => {
    const asOf = ledgerAsOf('2026-08-28', now)
    expect(placementsAsOf(placements, asOf)).toHaveLength(0)
  })

  it('never runs a future visit past today', () => {
    expect(ledgerAsOf('2026-12-01', now)).toEqual(now)
  })
})
