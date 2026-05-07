import { describe, expect, it } from 'vitest'
import { checkServiceArea, TRAVEL_CHARGE_AMOUNT } from './service-area'

describe('checkServiceArea', () => {
  it('accepts standard service area ZIPs without a travel charge', () => {
    expect(checkServiceArea('80133')).toMatchObject({
      allowed: true,
      tier: 'standard',
      travelCharge: 0,
    })
  })

  it('accepts travel-charge ZIPs with the flat travel fee', () => {
    for (const zip of ['80107', '80116', '80123', '80817', '80906']) {
      expect(checkServiceArea(zip)).toMatchObject({
        allowed: true,
        tier: 'travel_charge',
        travelCharge: TRAVEL_CHARGE_AMOUNT,
      })
    }
  })

  it('rejects outside-area ZIPs', () => {
    expect(checkServiceArea('80202')).toMatchObject({
      allowed: false,
      tier: 'outside_area',
      travelCharge: 0,
    })
  })
})
