import { describe, expect, it } from 'vitest'
import {
  dayBeforeTemplateKey,
  formatCustomerServiceSummary,
  getOpsTemplateKeysForEvent,
} from '@/lib/ops/communications'

describe('getOpsTemplateKeysForEvent', () => {
  it('sends both SMS and email when a job is rescheduled', () => {
    expect(getOpsTemplateKeysForEvent('job_rescheduled')).toEqual([
      'job_rescheduled_sms',
      'job_rescheduled_email',
    ])
  })

  it('uses the urine follow-up email when the job included the treatment', () => {
    expect(
      getOpsTemplateKeysForEvent('job_finished', [
        { name_snapshot: 'Regular Size Room (100 to 200 Sqft)' },
        { name_snapshot: 'Urine Eliminator Treatment' },
      ]),
    ).toEqual([
      'job_finished_sms',
      'job_finished_email_urine',
      'satisfaction_checkin_email',
    ])
  })

  it('uses the standard completion email when there is no urine treatment', () => {
    expect(
      getOpsTemplateKeysForEvent('job_finished', [
        { name_snapshot: 'Regular Size Room (100 to 200 Sqft)' },
      ]),
    ).toEqual([
      'job_finished_sms',
      'job_finished_email',
      'satisfaction_checkin_email',
    ])
  })

  it('falls back to the standard completion email when no line items are passed', () => {
    expect(getOpsTemplateKeysForEvent('job_finished')).toEqual([
      'job_finished_sms',
      'job_finished_email',
      'satisfaction_checkin_email',
    ])
  })
})

describe('formatCustomerServiceSummary', () => {
  it('shows quantity, customer-facing description, and line price', () => {
    expect(
      formatCustomerServiceSummary([
        {
          name_snapshot: 'Hall/Bathroom/Closet Carpet cleaning 30 to 100 sqft',
          quantity: 4,
          line_total: 100,
        },
        {
          name_snapshot: 'Regular Size Room (100 to 200 Sqft)',
          quantity: 8,
          line_total: 368,
        },
      ]),
    ).toBe(
      '- 4 × Small Area / Walk-in Closet (up to 100 sq ft) — $100.00\n' +
        '- 8 × Regular Size Room (100 to 200 Sqft) — $368.00',
    )
  })

  it('does not expose internal line items to customers', () => {
    expect(
      formatCustomerServiceSummary([
        {
          name_snapshot: 'Regular Size Room (100 to 200 Sqft)',
          quantity: 2,
          line_total: 92,
        },
        {
          name_snapshot: 'Google LSA Lead Charge',
          quantity: 1,
          line_total: 45,
        },
      ]),
    ).toBe('- 2 × Regular Size Room (100 to 200 Sqft) — $92.00')
  })
})

describe('which day-before text a customer gets', () => {
  it('sends a monitor visit its own wording, not the cleaning reminder', () => {
    expect(
      dayBeforeTemplateKey({ kind: 'restoration', visitType: 'monitor' }, null),
    ).toBe('day_before_restoration_monitor_sms')
  })

  it('sends the mitigation day the restoration wording', () => {
    expect(
      dayBeforeTemplateKey({ kind: 'restoration', visitType: 'mitigation' }, null),
    ).toBe('day_before_restoration_sms')
  })

  it('still recognises a restoration visit that lost its kind', () => {
    expect(dayBeforeTemplateKey({ kind: null, visitType: 'monitor' }, null)).toBe(
      'day_before_restoration_monitor_sms',
    )
  })

  it('leaves ordinary cleaning appointments alone', () => {
    expect(dayBeforeTemplateKey({ kind: 'cleaning', visitType: null }, null)).toBe(
      'day_before_residential_sms',
    )
    expect(
      dayBeforeTemplateKey({ kind: null, visitType: null }, 'Recovery Village'),
    ).toBe('day_before_recovery_village_sms')
  })

  it('does not let a restoration visit fall through to Recovery Village', () => {
    expect(
      dayBeforeTemplateKey(
        { kind: 'restoration', visitType: 'monitor' },
        'Recovery Village',
      ),
    ).toBe('day_before_restoration_monitor_sms')
  })
})

describe('which lifecycle messages a restoration visit sends', () => {
  const monitor = { kind: 'restoration', visitType: 'monitor' }
  const mitigation = { kind: 'restoration', visitType: 'mitigation' }
  const cleaning = { kind: 'cleaning', visitType: null }

  it('does not link the carpet cleaning video on the way to a flood', () => {
    expect(getOpsTemplateKeysForEvent('on_my_way', null, mitigation)).toEqual([
      'on_my_way_restoration_sms',
    ])
  })

  it('never asks for a review after a monitor day', () => {
    const keys = getOpsTemplateKeysForEvent('job_finished', null, monitor)
    expect(keys).toEqual(['job_finished_restoration_monitor_sms'])
    expect(keys).not.toContain('job_finished_sms')
    expect(keys).not.toContain('satisfaction_checkin_email')
  })

  it('tells the mitigation day it is not finished, it is drying', () => {
    expect(getOpsTemplateKeysForEvent('job_finished', null, mitigation)).toEqual([
      'job_finished_restoration_sms',
    ])
  })

  it('reschedules without quoting a total the visit does not have', () => {
    expect(getOpsTemplateKeysForEvent('job_rescheduled', null, monitor)).toEqual([
      'job_rescheduled_restoration_sms',
    ])
  })

  it('says nothing when a restoration visit is scheduled', () => {
    expect(getOpsTemplateKeysForEvent('job_scheduled', null, monitor)).toEqual([])
  })

  it('leaves cleaning jobs exactly as they were', () => {
    expect(getOpsTemplateKeysForEvent('on_my_way', null, cleaning)).toEqual([
      'on_my_way_sms',
    ])
    expect(getOpsTemplateKeysForEvent('on_my_way')).toEqual(['on_my_way_sms'])
    expect(getOpsTemplateKeysForEvent('job_finished', null, cleaning)).toContain(
      'satisfaction_checkin_email',
    )
  })
})
