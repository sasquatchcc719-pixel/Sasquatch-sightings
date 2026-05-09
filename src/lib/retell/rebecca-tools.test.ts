import { describe, expect, it } from 'vitest'
import { normalizeRebeccaAddressArgs } from './rebecca-tools'

describe('normalizeRebeccaAddressArgs', () => {
  it('keeps numeric ZIP codes from Retell tool arguments', () => {
    expect(
      normalizeRebeccaAddressArgs({
        address: {
          street_1: '123 Test Drive',
          city: 'Monument',
          zip_code: 80132,
        },
      }),
    ).toMatchObject({
      street_1: '123 Test Drive',
      city: 'Monument',
      zip_code: '80132',
    })
  })

  it('accepts common postal aliases and ZIP+4 values', () => {
    expect(
      normalizeRebeccaAddressArgs({
        street_1: '456 Test Lane',
        city: 'Colorado Springs',
        postal_code: '80921-1234',
      }),
    ).toMatchObject({
      street_1: '456 Test Lane',
      city: 'Colorado Springs',
      zip_code: '80921',
    })
  })

  it('infers unambiguous local ZIPs when callers give a city but Retell drops the ZIP', () => {
    expect(
      normalizeRebeccaAddressArgs({
        street_1: '789 Test Court',
        city: 'Palmer Lake',
      }),
    ).toMatchObject({
      city: 'Palmer Lake',
      zip_code: '80133',
    })
  })

  it('parses a full address string with city, state, and ZIP', () => {
    expect(
      normalizeRebeccaAddressArgs({
        address: '101 Main Street, Monument, CO 80132',
      }),
    ).toMatchObject({
      street_1: '101 Main Street',
      city: 'Monument',
      state: 'CO',
      zip_code: '80132',
    })
  })
})
