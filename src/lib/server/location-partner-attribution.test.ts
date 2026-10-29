import { describe, expect, it } from 'vitest'
import { matchLocationPartner } from './location-partner-attribution'

const partners = [
  {
    id: 'safe',
    location_name: 'SafeSplash Swim School',
    company_name: 'Safe splash',
    coupon_code: 'SAFE20',
  },
  {
    id: 'milano',
    location_name: 'Milano health spa',
    company_name: 'Milano health spa',
    coupon_code: 'MILA20',
  },
]

describe('location partner attribution', () => {
  it('matches an exact location, company, or coupon despite punctuation and case', () => {
    expect(matchLocationPartner(partners, 'Safe Splash')?.id).toBe('safe')
    expect(matchLocationPartner(partners, 'safesplash swim-school')?.id).toBe(
      'safe',
    )
    expect(matchLocationPartner(partners, 'mila20')?.id).toBe('milano')
  })

  it('does not guess from a partial or ambiguous name', () => {
    expect(matchLocationPartner(partners, 'safe')).toBeNull()
    expect(
      matchLocationPartner(
        [...partners, { ...partners[0], id: 'safe-2' }],
        'SAFE20',
      ),
    ).toBeNull()
  })
})
