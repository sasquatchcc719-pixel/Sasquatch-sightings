import { describe, expect, it } from 'vitest'
import { groupForConcept, GROUP_ORDER } from './restoration-catalog-groups'

describe('groupForConcept', () => {
  it('files the everyday items where Charles would look for them', () => {
    expect(groupForConcept('EXT', 'Water extraction from carpeted floor')).toBe('Extraction')
    expect(groupForConcept('FCC', 'Tear out wet non-salvageable carpet, cut & bag')).toBe('Carpet & pad')
    expect(groupForConcept('PAD', 'Tear out wet carpet pad and bag for disposal')).toBe('Carpet & pad')
    expect(groupForConcept('TACK', 'Tear out tackless strip and bag')).toBe('Carpet & pad')
    expect(groupForConcept('DRYW4', "Tear out wet drywall, bag, per LF - up to 4' tall")).toBe(
      'Drywall, trim & insulation',
    )
    expect(groupForConcept('BASE', 'Tear out baseboard')).toBe('Drywall, trim & insulation')
    expect(groupForConcept('INS', 'Tear out and bag wet insulation')).toBe(
      'Drywall, trim & insulation',
    )
  })

  it('treats anything billed per 24 hours as equipment', () => {
    expect(groupForConcept('DRY++', 'Axial fan air mover - 1 HP (per 24 hr period)')).toBe('Equipment')
    expect(groupForConcept('DHM>>', 'Dehumidifier (per 24 hr period) - 110-159 ppd')).toBe('Equipment')
    expect(groupForConcept('NAFAN', 'Negative air fan/Air scrubber (24 hr period)')).toBe('Equipment')
  })

  it('separates fees and labour from the work itself', () => {
    expect(groupForConcept('ESRVD', 'Emergency service call - during business hours')).toBe(
      'Service calls & labor',
    )
    expect(groupForConcept('EQ', 'Equipment setup, take down, and monitoring (hourly charge)')).toBe(
      'Service calls & labor',
    )
  })

  it('puts treatment and PPE in their own buckets', () => {
    expect(groupForConcept('GRM', 'Apply anti-microbial agent to surface')).toBe('Treatment & cleanup')
    expect(groupForConcept('PPERH', 'Respirator - Half face (per day)')).toBe('Containment & safety')
  })

  it('never invents a group outside the known list', () => {
    const group = groupForConcept('ZZZZ', 'something entirely unfamiliar')
    expect(GROUP_ORDER).toContain(group)
    expect(group).toBe('Other')
  })
})
