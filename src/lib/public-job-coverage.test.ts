import { describe, expect, it } from 'vitest'
import {
  buildHistoricalJobPins,
  type HistoricalServiceAddress,
} from './public-job-coverage'

const address = (
  overrides: Partial<HistoricalServiceAddress> = {},
): HistoricalServiceAddress => ({
  id: 'address-1',
  customer_id: 'customer-1',
  street_1: '123 Main Street',
  city: 'Monument',
  state: 'CO',
  zip_code: '80132',
  latitude: 39.091,
  longitude: -104.872,
  ...overrides,
})

describe('buildHistoricalJobPins', () => {
  it('keeps one stable privacy-offset pin per unique historical address', () => {
    const addresses = [
      address(),
      address({ id: 'duplicate', street_1: '123 MAIN STREET' }),
      address({
        id: 'no-history',
        customer_id: 'customer-2',
        street_1: '456 Second Street',
      }),
    ]
    const input = {
      addresses,
      customerIdsWithJobHistory: new Set(['customer-1']),
      publishedJobs: [],
    }

    const first = buildHistoricalJobPins(input)
    const second = buildHistoricalJobPins(input)

    expect(first).toHaveLength(1)
    expect(second).toEqual(first)
    expect(first[0].gps_fuzzy_lat).not.toBe(39.091)
    expect(first[0].gps_fuzzy_lng).not.toBe(-104.872)
  })

  it('removes addresses already represented by a linked published job', () => {
    const pins = buildHistoricalJobPins({
      addresses: [address()],
      customerIdsWithJobHistory: new Set(['customer-1']),
      publishedJobs: [
        {
          gps_lat: 39.2,
          gps_lng: -104.9,
          represented_address_id: 'address-1',
        },
      ],
    })

    expect(pins).toEqual([])
  })

  it('removes a legacy published job matched to the address by proximity', () => {
    const pins = buildHistoricalJobPins({
      addresses: [address()],
      customerIdsWithJobHistory: new Set(['customer-1']),
      publishedJobs: [
        {
          gps_lat: 39.0913,
          gps_lng: -104.8722,
          represented_address_id: null,
        },
      ],
    })

    expect(pins).toEqual([])
  })

  it('rejects invalid and out-of-state geocodes', () => {
    const pins = buildHistoricalJobPins({
      addresses: [
        address({ latitude: null }),
        address({
          id: 'illinois',
          street_1: '456 Third Street',
          latitude: 41.11,
          longitude: -87.86,
        }),
      ],
      customerIdsWithJobHistory: new Set(['customer-1']),
      publishedJobs: [],
    })

    expect(pins).toEqual([])
  })
})
