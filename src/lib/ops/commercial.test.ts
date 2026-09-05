// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  newAgreementContent,
  agreementContentSchema,
  publicationIssues,
  phaseTotal,
  serviceRequestDetailsSchema,
  SIGNATURE_CONSENT,
  type CommercialAgreement,
} from './commercial'
import { agreementHash } from './commercial-server'
import { commercialDocument } from './commercial-document'

describe('commercial agreement integrity', () => {
  it('requests 24 hours notice in new drafts without adding fees or penalties', () => {
    const content = newAgreementContent('Example Business')
    expect(content.cancellation_terms).toContain(
      'We request at least 24 hours’ notice',
    )
    expect(content.cancellation_terms).not.toMatch(/fee|penalt/i)
    expect(publicationIssues({ ...content, cancellation_terms: '' })).toContain(
      'Confirm cancellation and rescheduling terms.',
    )
  })
  it('preserves the actual Saltgrass arithmetic and keeps optional maintenance out of the initial total', () => {
    const c = newAgreementContent('Saltgrass')
    c.lines = [
      {
        ...c.lines[0],
        name: 'Carpet',
        quantity: 2258,
        unit_price: 0.4,
        unit: 'per_sq_ft',
      },
      {
        ...c.lines[0],
        id: crypto.randomUUID(),
        name: 'Content manipulation',
        quantity: 2,
        unit_price: 73.37,
        unit: 'per_hour',
      },
      {
        ...c.lines[0],
        id: crypto.randomUUID(),
        phase: 'optional',
        name: 'VLM maintenance',
        quantity: 2258,
        unit_price: 0.28,
      },
    ]
    expect(phaseTotal(c, 'initial')).toBe(1049.94)
    expect(phaseTotal(c, 'optional')).toBe(632.24)
  })
  it('requires actual commercial terms before publication and validates dates and quantities', () => {
    const c = newAgreementContent('Saltgrass')
    expect(publicationIssues(c)).toContain('Confirm payment terms.')
    expect(
      agreementContentSchema.safeParse({ ...c, effective_from: '2026-02-30' })
        .success,
    ).toBe(false)
    expect(
      agreementContentSchema.safeParse({
        ...c,
        effective_from: '2026-09-01',
        effective_until: '2026-08-31',
      }).success,
    ).toBe(false)
    expect(
      agreementContentSchema.safeParse({
        ...c,
        lines: [{ ...c.lines[0], quantity: -1 }],
      }).success,
    ).toBe(false)
  })
  it('produces the same fingerprint after JSONB reorders keys and detects changed price or scope', () => {
    const c = newAgreementContent('Saltgrass')
    const reordered = Object.fromEntries(
      Object.entries(c).reverse(),
    ) as typeof c
    expect(agreementHash(c)).toBe(agreementHash(reordered))
    expect(agreementHash(c)).not.toBe(
      agreementHash({ ...c, lines: [{ ...c.lines[0], unit_price: 9 }] }),
    )
    expect(agreementHash(c)).not.toBe(
      agreementHash({ ...c, payment_terms: 'Net 30' }),
    )
  })
  it('exports the exact consent and signed identity while escaping customer-provided HTML', () => {
    const agreement = {
      id: 'a',
      version: 2,
      status: 'signed',
      content: {
        ...newAgreementContent('<script>alert(1)</script>'),
        additional_terms: '<img src=x onerror=alert(1)>',
      },
      signed_name: 'Pat & Co',
      signed_title: 'Manager',
      signed_email: 'pat@example.com',
      signed_at: '2026-09-04T10:00:00Z',
      signature_consent: SIGNATURE_CONSENT,
      content_hash: 'abc',
    } as CommercialAgreement
    const html = commercialDocument(agreement)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('Pat &amp; Co')
    expect(html).toContain(SIGNATURE_CONSENT)
    expect(html).toContain('Content SHA-256: abc')
  })
  it('bounds structured client requests and rejects unknown payload fields', () => {
    expect(
      serviceRequestDetailsSchema.safeParse({
        service: 'VLM',
        preferred_date: '2026-09-15',
      }).success,
    ).toBe(true)
    expect(
      serviceRequestDetailsSchema.safeParse({
        customer_id: crypto.randomUUID(),
      }).success,
    ).toBe(false)
    expect(
      serviceRequestDetailsSchema.safeParse({ area: 'x'.repeat(1001) }).success,
    ).toBe(false)
  })
})
