import { describe, expect, it } from 'vitest'

/**
 * Mirrors the day-matching in the restoration photo uploader. A photo taken on
 * day 2 must attach to day 2's visit, not to whichever visit happens to be open
 * when the backlog gets uploaded.
 */
function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const VISITS = [
  { id: 'v1', appointment_date: '2026-08-30' },
  { id: 'v2', appointment_date: '2026-08-31' },
  { id: 'v3', appointment_date: '2026-09-01' },
]

function targetVisit(captured: Date | null, activeId: string) {
  if (!captured) return activeId
  return VISITS.find((v) => v.appointment_date === toDateKey(captured))?.id ?? activeId
}

describe('photo day assignment', () => {
  it('files a photo on the visit it was taken during', () => {
    expect(targetVisit(new Date(2026, 7, 31, 14, 30), 'v3')).toBe('v2')
    expect(targetVisit(new Date(2026, 8, 1, 9, 0), 'v1')).toBe('v3')
  })

  it('falls back to the open visit when no day matches', () => {
    expect(targetVisit(new Date(2026, 11, 25, 9, 0), 'v2')).toBe('v2')
  })

  it('falls back when the file carries no timestamp', () => {
    expect(targetVisit(null, 'v1')).toBe('v1')
  })

  it('uses local calendar days, not UTC', () => {
    // 11pm local on the 31st must not roll into the 1st.
    expect(toDateKey(new Date(2026, 7, 31, 23, 0))).toBe('2026-08-31')
  })
})
