import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  forwardGeocodeAddress,
  invalidateGeocodeForAddressUpdate,
  isVerifiedStreetCandidate,
} from './forward-geocode'

const submitted = {
  street_1: '123 N Main Street, Unit 4',
  city: 'Monument',
  state: 'CO',
  zip_code: '80132',
}

const exactCandidate = {
  lat: '39.1001',
  lon: '-104.8501',
  display_name: '123 North Main Street, Monument, Colorado 80132',
  address: {
    house_number: '123',
    road: 'North Main St',
    town: 'Monument',
    state: 'Colorado',
    'ISO3166-2-lvl4': 'US-CO',
    postcode: '80132-1234',
  },
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isVerifiedStreetCandidate', () => {
  it('accepts the submitted house number and normalized street', () => {
    expect(isVerifiedStreetCandidate(submitted, exactCandidate)).toBe(true)
  })

  it('rejects city or ZIP centroids without a street-level match', () => {
    expect(
      isVerifiedStreetCandidate(submitted, {
        ...exactCandidate,
        address: {
          town: 'Monument',
          state: 'Colorado',
          postcode: '80132',
        },
      }),
    ).toBe(false)
  })

  it('rejects a different street even when city and ZIP agree', () => {
    expect(
      isVerifiedStreetCandidate(submitted, {
        ...exactCandidate,
        address: { ...exactCandidate.address, road: 'Second Street' },
      }),
    ).toBe(false)
  })
})

describe('forwardGeocodeAddress', () => {
  it('skips an unverified first candidate and returns a verified result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            ...exactCandidate,
            address: { city: 'Monument', state: 'Colorado', postcode: '80132' },
          },
          exactCandidate,
        ],
      }),
    )

    await expect(forwardGeocodeAddress(submitted)).resolves.toEqual({
      lat: 39.1001,
      lng: -104.8501,
      displayName: exactCandidate.display_name,
      resolvedCity: 'Monument',
      neighborhood: '',
    })
  })

  it('returns null instead of falling back to an area centroid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '39.0916586',
            lon: '-104.872758',
            address: {
              town: 'Monument',
              state: 'Colorado',
              postcode: '80132',
            },
          },
        ],
      }),
    )

    await expect(forwardGeocodeAddress(submitted)).resolves.toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('invalidateGeocodeForAddressUpdate', () => {
  it('clears stale coordinates when a location field is edited', () => {
    const updates: Record<string, unknown> = { street_1: '456 New Street' }

    expect(invalidateGeocodeForAddressUpdate(updates)).toBe(true)
    expect(updates).toMatchObject({
      latitude: null,
      longitude: null,
      geocoded_at: null,
      geocode_source: null,
    })
  })

  it('preserves coordinates for notes-only edits', () => {
    const updates: Record<string, unknown> = { notes: 'Use side gate' }

    expect(invalidateGeocodeForAddressUpdate(updates)).toBe(false)
    expect(updates).toEqual({ notes: 'Use side gate' })
  })
})
