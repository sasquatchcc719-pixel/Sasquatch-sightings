import { describe, it, expect } from 'vitest'
import { buildNotePrompt, type VisitFacts } from './restoration-visit-note'

const facts: VisitFacts = {
  visitLabel: 'monitor',
  visitDate: '2026-08-31',
  areas: [{ name: 'Basement', sqft: 493 }],
  readings: [
    { label: '1', material: 'Framing', value: 25 },
    { label: '2', material: 'Framing', value: 30 },
  ],
  equipment: [
    { code: 'air mover', units: 8 },
    { code: 'dehumidifier', units: 1 },
  ],
  airReadings: [{ role: 'affected', tempF: 77, rhPct: 38 }],
}

describe('buildNotePrompt', () => {
  it("hands the model the day's real figures so it need not invent any", () => {
    const prompt = buildNotePrompt(facts, 'closet is still wet')
    expect(prompt).toContain('point 1 (Framing) 25%')
    expect(prompt).toContain('Basement (493 sq ft affected)')
    expect(prompt).toContain('affected 77°F / 38% RH')
  })

  it('names equipment in words a customer can read', () => {
    // "8 DRY and 1 DHM>>" means nothing to a homeowner or an adjuster, and this
    // note is read by both.
    const prompt = buildNotePrompt(facts, 'moved two fans')
    expect(prompt).toContain('8 air movers, 1 dehumidifier')
    expect(prompt).not.toMatch(/DHM|DRY\b/)
  })

  it('keeps what was said separate from what is known', () => {
    // The separation is the guardrail: everything above the line is fact from
    // the database, everything below it is Charles talking.
    const prompt = buildNotePrompt(facts, 'the closet is still not moving')
    const [known, said] = prompt.split('WHAT THE TECHNICIAN SAID:')
    expect(known).toContain('EQUIPMENT RUNNING')
    expect(said.trim()).toBe('the closet is still not moving')
  })

  it('leaves out sections the day has nothing for', () => {
    const bare = buildNotePrompt(
      { ...facts, readings: [], airReadings: [], equipment: [] },
      'walked it, nothing changed',
    )
    expect(bare).not.toContain('MOISTURE READINGS')
    expect(bare).not.toContain('EQUIPMENT RUNNING')
    expect(bare).toContain('walked it, nothing changed')
  })
})
