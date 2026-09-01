import { describe, it, expect } from 'vitest'
import {
  unitDays,
  equipmentLedger,
  ledgerAsOf,
  placementsAsOf,
} from './restoration-equipment-ledger'

const TODAY = '2026-08-31'

describe('unitDays', () => {
  it('counts nights on the job, which is how the work is quoted', () => {
    // Set Saturday, pulled Tuesday: three days, which is exactly what the
    // estimate said for eight fans.
    expect(unitDays('2026-08-29', '2026-09-01', TODAY)).toBe(3)
  })

  it('charges a day for equipment set down and collected the same afternoon', () => {
    expect(unitDays('2026-08-31', '2026-08-31', TODAY)).toBe(1)
  })

  it('keeps counting while a unit is still running', () => {
    expect(unitDays('2026-08-29', null, TODAY)).toBe(2)
    expect(unitDays('2026-08-29', null, '2026-09-01')).toBe(3)
  })

  it('does not care what time of day anything was entered', () => {
    // The whole point: Charles enters Saturday's equipment on Monday, and it
    // still bills from Saturday.
    expect(unitDays('2026-08-29', null, TODAY)).toBe(2)
  })
})

describe('equipmentLedger', () => {
  const placements = [
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `run-${i}`,
      catalog_code: 'DRY',
      placed_on: '2026-08-29',
      removed_on: null,
    })),
    ...Array.from({ length: 2 }, (_, i) => ({
      id: `pulled-${i}`,
      catalog_code: 'DRY',
      placed_on: '2026-08-29',
      removed_on: '2026-08-31',
    })),
    { id: 'dehu', catalog_code: 'DHM>>', placed_on: '2026-08-29', removed_on: null },
  ]

  it('separates what is running from what has been billed', () => {
    const [fans] = equipmentLedger(placements, TODAY).filter((l) => l.code === 'DRY')
    expect(fans.running).toBe(6)
    expect(fans.pulled).toBe(2)
    // Six running two days, two pulled after two days: sixteen.
    expect(fans.unitDays).toBe(16)
  })

  it('keeps billing a pulled unit for the days it ran', () => {
    const after = equipmentLedger(placements, TODAY).find((l) => l.code === 'DRY')!
    expect(after.units.filter((u) => u.removedOn).every((u) => u.days === 2)).toBe(true)
  })

  it('lists every unit so the total can be checked', () => {
    const [fans] = equipmentLedger(placements, TODAY).filter((l) => l.code === 'DRY')
    expect(fans.units).toHaveLength(8)
    expect(fans.units.reduce((sum, u) => sum + u.days, 0)).toBe(fans.unitDays)
  })

  it('keeps each kind of equipment apart', () => {
    expect(equipmentLedger(placements, TODAY).map((l) => l.code).sort()).toEqual([
      'DHM>>',
      'DRY',
    ])
  })
})

describe('what the equipment had cost on a given day', () => {
  const placements = [
    { id: 'a', catalog_code: 'DRY', placed_on: '2026-08-29', removed_on: null },
    { id: 'b', catalog_code: 'DRY', placed_on: '2026-08-31', removed_on: null },
  ]
  const today = '2026-09-02'

  it('climbs day by day, which is the shape of a drying job', () => {
    const days = ['2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01'].map((day) => {
      const asOf = ledgerAsOf(day, today)
      const [line] = equipmentLedger(placementsAsOf(placements, asOf), asOf)
      return line?.unitDays ?? 0
    })
    // 29th: one fan, one day. 30th: still one fan, still one day (a fan set
    // yesterday has done one night). 31st: first fan two days plus the second
    // fan's first. 1st: three plus one.
    expect(days).toEqual([1, 1, 3, 4])
    for (let i = 1; i < days.length; i++) {
      expect(days[i]).toBeGreaterThanOrEqual(days[i - 1])
    }
    expect(days[days.length - 1]).toBeGreaterThan(days[0])
  })

  it('counts nothing on a day before the equipment was set down', () => {
    expect(placementsAsOf(placements, ledgerAsOf('2026-08-28', today))).toHaveLength(0)
  })

  it('never runs a future visit past today', () => {
    expect(ledgerAsOf('2026-12-01', today)).toBe(today)
  })
})
