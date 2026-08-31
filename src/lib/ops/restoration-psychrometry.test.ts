import { describe, it, expect } from 'vitest'
import {
  AIR_ROLES,
  grainsPerPound,
  dewPointF,
  dehumidifierVerdict,
  dryGoalVerdict,
  ventilationNote,
  trendVerdict,
} from './restoration-psychrometry'

const at = (tempF: number | null, rhPct: number | null, role: string, takenAt = '2026-08-29T09:00:00-06:00') =>
  ({ role: role as never, tempF, rhPct, takenAt })

describe('grainsPerPound', () => {
  it('matches the psychrometric chart at the reference conditions', () => {
    // 70°F / 50% RH is ~55 GPP on every chart in the trade.
    expect(grainsPerPound(70, 50)).toBeCloseTo(54.4, 0)
    // 80°F / 60% RH is ~92 GPP.
    expect(grainsPerPound(80, 60)).toBeCloseTo(92, 0)
    // Cold and dry: 40°F / 30% RH is just under 11 GPP.
    expect(grainsPerPound(40, 30)).toBeCloseTo(10.8, 1)
  })

  it('rises with both temperature and humidity', () => {
    expect(grainsPerPound(80, 50)!).toBeGreaterThan(grainsPerPound(70, 50)!)
    expect(grainsPerPound(70, 60)!).toBeGreaterThan(grainsPerPound(70, 50)!)
  })

  it('refuses nonsense rather than returning a number', () => {
    expect(grainsPerPound(70, 140)).toBeNull()
    expect(grainsPerPound(70, -5)).toBeNull()
    expect(grainsPerPound(Number.NaN, 50)).toBeNull()
  })
})

describe('dewPointF', () => {
  it('is the temperature itself at saturation', () => {
    expect(dewPointF(70, 100)).toBeCloseTo(70, 0)
  })

  it('sits below the air temperature otherwise', () => {
    expect(dewPointF(70, 50)).toBeCloseTo(50.5, 0)
  })
})

describe('dehumidifierVerdict', () => {
  it("reports Charles's near-dry room without calling it a fault", () => {
    // Room 74/44 = 54.9 GPP, outlet 92/24 = 53.6: 1.3 GPP of depression on a
    // room that is nearly dry. Three earlier versions flagged this. There is
    // little water left to take, which is not a broken machine.
    const v = dehumidifierVerdict(at(74, 44, 'affected'), at(92, 24, 'dehu_outlet'))
    expect(v.status).toBe('good')
    expect(v.detail).not.toMatch(/filter|coils|breaker|worth a look/i)
  })

  it('gives the rating as a fact, not as a target to hit', () => {
    const v = dehumidifierVerdict(at(80, 60, 'affected'), at(90, 25, 'dehu_outlet'))
    expect(v.detail).toMatch(/rated 28 GPP at 80°F and 60%/)
    expect(v.detail).toMatch(/pulls less as the room dries out/)
    expect(v.detail).not.toMatch(/should be/i)
  })

  it('raises no alarm anywhere, including at zero depression', () => {
    // "Any grain depression is good. It doesn't have to be a lot if there's not
    // a lot there to begin with." And zero is not proof of a fault either: an
    // LGR in defrost briefly blows air that is not dry.
    for (const [t, h] of [[74, 44], [74, 50], [92, 24], [78, 30]] as const) {
      const v = dehumidifierVerdict(at(74, 44, 'affected'), at(t, h, 'dehu_outlet'))
      expect(v.status).not.toBe('problem')
    }
  })

  it('suggests re-reading rather than declaring a fault at zero', () => {
    const v = dehumidifierVerdict(at(74, 44, 'affected'), at(74, 50, 'dehu_outlet'))
    expect(v.detail).toMatch(/defrost/i)
    expect(v.detail).not.toMatch(/filter|coils|not working/i)
  })

  it('calls any positive depression good, however small', () => {
    const v = dehumidifierVerdict(at(74, 44, 'affected'), at(92, 24, 'dehu_outlet'))
    expect(v.status).toBe('good')
    expect(v.headline).toBe('Pulling 1.3 GPP')
  })

  it('says so when a reading is missing rather than guessing', () => {
    expect(
      dehumidifierVerdict(at(80, 60, 'affected'), at(null, null, 'dehu_outlet')).status,
    ).toBe('unknown')
  })
})

describe('dryGoalVerdict', () => {
  it('measures the chamber against unaffected air in the same building', () => {
    const v = dryGoalVerdict(at(75, 35, 'affected'), at(72, 40, 'unaffected'))
    expect(v.status).toBe('good')
  })

  it('asks for an unaffected reading rather than falling back to outside', () => {
    // Outside swings with the weather. "Drier than outside" on a humid day is
    // confident nonsense about a basement that is still soaking.
    const v = dryGoalVerdict(at(80, 70, 'affected'), at(null, null, 'unaffected'))
    expect(v.status).toBe('unknown')
    expect(v.detail).toMatch(/unaffected/i)
    expect(v.detail).toMatch(/outside air is not it/i)
  })

  it('says how far above the goal the chamber still is', () => {
    const v = dryGoalVerdict(at(80, 70, 'affected'), at(70, 40, 'unaffected'))
    expect(v.status).toBe('problem')
    expect(v.headline).toMatch(/above the dry goal/)
  })
})

describe('ventilationNote', () => {
  it('speaks up when opening the building would beat the equipment', () => {
    const note = ventilationNote(at(80, 70, 'affected'), at(50, 40, 'outside'))
    expect(note).not.toBeNull()
    expect(note!.headline).toMatch(/drier/)
  })

  it('stays quiet when outside is no help, which is most days', () => {
    expect(ventilationNote(at(75, 40, 'affected'), at(72, 45, 'outside'))).toBeNull()
    expect(ventilationNote(at(75, 40, 'affected'), at(null, null, 'outside'))).toBeNull()
  })
})

describe('trendVerdict', () => {
  it('confirms drying when the affected air comes down', () => {
    const v = trendVerdict([
      at(80, 65, 'affected', '2026-08-29T09:00:00-06:00'),
      at(78, 40, 'affected', '2026-08-31T09:00:00-06:00'),
    ])
    expect(v.status).toBe('good')
  })

  it('says plainly that the air is not drying, without blaming the gear', () => {
    const v = trendVerdict([
      at(78, 60, 'affected', '2026-08-29T09:00:00-06:00'),
      at(78, 62, 'affected', '2026-08-31T09:00:00-06:00'),
    ])
    expect(v.status).toBe('problem')
    expect(v.detail).toMatch(/not drying out/i)
    // Charles's equipment is old and works. The reading is the finding; the
    // machine is not the accused.
    expect(v.detail).not.toMatch(/not working|broken|failing/i)
  })

  it('will not call a trend from one visit', () => {
    expect(trendVerdict([at(80, 65, 'affected')]).status).toBe('unknown')
  })

  it('ignores dehu and outside readings when judging the chamber', () => {
    const v = trendVerdict([
      at(80, 65, 'affected', '2026-08-29T09:00:00-06:00'),
      at(95, 20, 'dehu_outlet', '2026-08-29T09:05:00-06:00'),
      at(60, 90, 'outside', '2026-08-31T08:00:00-06:00'),
      at(78, 40, 'affected', '2026-08-31T09:00:00-06:00'),
    ])
    expect(v.status).toBe('good')
  })
})

describe('a reference reading from another day', () => {
  it('is used, but the report says it was', () => {
    // Outside air changes overnight; a claim file should not imply the two
    // numbers were taken side by side when they were two days apart.
    const v = dryGoalVerdict(
      at(77, 38, 'affected', '2026-08-31T09:00:00-06:00'),
      at(72, 40, 'unaffected', '2026-08-29T09:00:00-06:00'),
    )
    expect(v.detail).toMatch(/different day/i)
  })

  it('says nothing extra when they were taken together', () => {
    const v = dryGoalVerdict(
      at(77, 38, 'affected', '2026-08-31T09:00:00-06:00'),
      at(72, 40, 'unaffected', '2026-08-31T09:05:00-06:00'),
    )
    expect(v.detail).not.toMatch(/different day/i)
  })
})

describe('the room air is the intake', () => {
  it('measures depression from the affected area, not a second reading', () => {
    // Charles: "we don't need the intake, it's just gonna be whatever the room
    // is". The trade computes depression exactly this way.
    const v = dehumidifierVerdict(at(80, 60, 'affected'), at(90, 25, 'dehu_outlet'))
    expect(v.status).toBe('good')
    expect(v.headline).toMatch(/Pulling/)
  })

  it('offers no verdict until both the room and the outlet are logged', () => {
    expect(dehumidifierVerdict(at(80, 60, 'affected'), at(null, null, 'dehu_outlet')).status).toBe('unknown')
    expect(dehumidifierVerdict(at(null, null, 'affected'), at(90, 25, 'dehu_outlet')).status).toBe('unknown')
  })

  it('does not offer Dehu intake as something to log', () => {
    expect(AIR_ROLES.map((r) => r.value)).not.toContain('dehu_intake')
    expect(AIR_ROLES.map((r) => r.value)).toEqual([
      'affected',
      'unaffected',
      'outside',
      'dehu_outlet',
    ])
  })
})
