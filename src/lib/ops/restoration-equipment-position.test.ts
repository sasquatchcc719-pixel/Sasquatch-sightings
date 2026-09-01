import { describe, it, expect } from 'vitest'
import { positionForVisit, movesOnVisit } from './restoration-equipment-position'

const fan = { id: 'fan-1', map_x: 4, map_y: 4, placed_at: '2026-08-29T09:00:00-06:00' }

const positions = [
  {
    placement_id: 'fan-1',
    appointment_id: 'monitor-mon',
    map_x: 12,
    map_y: 3,
    visit_date: '2026-08-31',
    // Entered days later. The move still belongs to the 31st.
    moved_at: '2026-09-04T22:00:00-06:00',
  },
]

describe('positionForVisit', () => {
  it('shows where it was first set down before anything moved it', () => {
    const at = positionForVisit(fan, positions, {
      id: 'mitigation',
      appointment_date: '2026-08-29',
    })
    expect(at).toMatchObject({ x: 4, y: 4, movedOnThisVisit: false })
  })

  it('shows the move on the visit it was made', () => {
    const at = positionForVisit(fan, positions, {
      id: 'monitor-mon',
      appointment_date: '2026-08-31',
    })
    expect(at).toMatchObject({ x: 12, y: 3, movedOnThisVisit: true })
  })

  it('carries a position forward to a visit where nothing was moved', () => {
    // The difference from readings: a fan not moved is still where it was.
    const at = positionForVisit(fan, positions, {
      id: 'monitor-tue',
      appointment_date: '2026-09-01',
    })
    expect(at).toMatchObject({ x: 12, y: 3, movedOnThisVisit: false })
  })

  it('does not show a later move on an earlier visit', () => {
    // Opening Saturday must not draw Monday's layout.
    const at = positionForVisit(fan, positions, {
      id: 'monitor-sun',
      appointment_date: '2026-08-30',
    })
    expect(at).toMatchObject({ x: 4, y: 4 })
  })

  it('ignores moves belonging to other equipment', () => {
    const other = [{ ...positions[0], placement_id: 'fan-2' }]
    const at = positionForVisit(fan, other, {
      id: 'monitor-mon',
      appointment_date: '2026-08-31',
    })
    expect(at).toMatchObject({ x: 4, y: 4, movedOnThisVisit: false })
  })
})

describe('movesOnVisit', () => {
  it('counts what was moved that day', () => {
    expect(movesOnVisit(positions, 'monitor-mon')).toBe(1)
    expect(movesOnVisit(positions, 'monitor-tue')).toBe(0)
    expect(movesOnVisit(positions, null)).toBe(0)
  })
})

describe('a move entered after the fact', () => {
  it('belongs to the day it was made, not the day it was typed', () => {
    // The same fault that broke readings and equipment billing: this row was
    // written on the 4th for a move made on the 31st.
    const onTheDay = positionForVisit(fan, positions, {
      id: 'monitor-mon',
      appointment_date: '2026-08-31',
    })
    expect(onTheDay).toMatchObject({ x: 12, y: 3, movedOnThisVisit: true })

    // And the day before it still shows the original spot.
    const dayBefore = positionForVisit(fan, positions, {
      id: 'monitor-sun',
      appointment_date: '2026-08-30',
    })
    expect(dayBefore).toMatchObject({ x: 4, y: 4 })
  })
})
