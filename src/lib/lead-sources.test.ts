import { describe, expect, it } from 'vitest'
import {
  getPublicLeadSourceOptions,
  isSelfAttribution,
  normalizeLeadSource,
  validateLeadSourceDetail,
} from './lead-sources'

describe('lead source normalization', () => {
  it.each([
    ['Google', 'google_search'],
    ['Google Search / Maps', 'google_search'],
    ['Google LSA', 'google_lsa'],
    ['Google Local Services', 'google_lsa'],
    ['Nextdoor', 'nextdoor'],
    ['Door hanger', 'door_hanger'],
    ['Doorhanger', 'door_hanger'],
    ['Door flyer', 'door_hanger'],
    ['Repeat customer', 'repeat_customer'],
    ['Word of mouth / Referral', 'referral'],
    ['NFC Card', 'nfc_partner'],
    ['Nail salon (Milano) / SCC20 card', 'nfc_partner'],
  ])('maps %s to %s', (value, expected) => {
    expect(normalizeLeadSource(value).source_key).toBe(expected)
  })

  it('preserves unknown values as original/detail text under other', () => {
    const result = normalizeLeadSource('retell_rabecca')

    expect(result.source_key).toBe('other')
    expect(result.original_lead_source).toBe('retell_rabecca')
    expect(result.lead_source_detail).toBe('retell_rabecca')
  })

  it('preserves NFC partner/card details', () => {
    const result = normalizeLeadSource('NFC Card - SCC20')

    expect(result.source_key).toBe('nfc_partner')
    expect(result.lead_source_detail).toBe('SCC20')
  })

  it('requires detail for configured sources', () => {
    const referral = normalizeLeadSource('referral')
    const withDetail = normalizeLeadSource('referral', 'Jane Neighbor')

    expect(validateLeadSourceDetail(referral)).toContain('requires a detail')
    expect(validateLeadSourceDetail(withDetail)).toBeNull()
  })

  it('returns active public options in display order', () => {
    const options = getPublicLeadSourceOptions()

    expect(options[0].key).toBe('google_search')
    expect(options.map((option) => option.key)).toContain('google_lsa')
    expect(options.map((option) => option.key)).toContain('door_hanger')
    expect(options.at(-1)?.key).toBe('other')
  })

  it('identifies booking channels that must not be marketing sources', () => {
    expect(isSelfAttribution('Harry SMS Assistant')).toBe(true)
    expect(isSelfAttribution('Scout website chat')).toBe(true)
    expect(isSelfAttribution('retell_rabecca')).toBe(true)
    expect(isSelfAttribution('Google Local Services')).toBe(false)
  })
})
