import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  coloradoAddressPoint,
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

const highwayAddress = {
  street_1: '443 Highway 105',
  city: 'Palmer Lake',
  state: 'CO',
  zip_code: '80133',
}
const highwayCandidate = {
  lat: '39.1124001',
  lon: '-104.8965049',
  address: {
    house_number: '443',
    road: 'CO 105',
    village: 'Palmer Lake',
    state: 'Colorado',
    'ISO3166-2-lvl4': 'US-CO',
    postcode: '80133',
  },
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('isVerifiedStreetCandidate', () => {
  it('matches directional suffixes and Point abbreviations without losing direction, house or ZIP checks', () => {
    const address = {
      street_1: '20071 Thunder Road W',
      city: 'Colorado Springs',
      state: 'CO',
      zip_code: '80908',
    }
    const candidate = {
      address: {
        house_number: '20071',
        road: 'W Thunder Rd',
        city: 'Monument',
        state: 'Colorado',
        postcode: '80908',
      },
    }
    expect(isVerifiedStreetCandidate(address, candidate)).toBe(true)
    for (const change of [
      { road: 'E Thunder Rd' },
      { road: 'W Lightning Rd' },
      { house_number: '20072' },
      { postcode: '80132' },
    ]) {
      expect(
        isVerifiedStreetCandidate(address, {
          address: { ...candidate.address, ...change },
        }),
      ).toBe(false)
    }
    expect(
      isVerifiedStreetCandidate(
        {
          street_1: '890 East Kings Deer Point',
          city: 'Monument',
          state: 'CO',
          zip_code: '80132',
        },
        {
          address: {
            house_number: '890',
            road: 'E Kings Deer Pt',
            city: 'Monument',
            state: 'Colorado',
            postcode: '80132',
          },
        },
      ),
    ).toBe(true)
  })

  it('matches a Colorado highway alias while preserving the route and house number', () => {
    expect(isVerifiedStreetCandidate(highwayAddress, highwayCandidate)).toBe(
      true,
    )
    for (const address of [
      { ...highwayCandidate.address, road: 'CO 106' },
      { ...highwayCandidate.address, road: 'US 105' },
      { ...highwayCandidate.address, house_number: '433' },
    ]) {
      expect(
        isVerifiedStreetCandidate(highwayAddress, {
          ...highwayCandidate,
          address,
        }),
      ).toBe(false)
    }
  })

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
  it('queries the provider highway name without changing the submitted address', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ features: [] }),
        })
        .mockResolvedValue({
          ok: true,
          json: async () => [highwayCandidate],
        }),
    )
    await expect(forwardGeocodeAddress(highwayAddress)).resolves.toMatchObject({
      lat: 39.1124001,
      lng: -104.8965049,
    })
    const url = new URL(vi.mocked(fetch).mock.calls[1][0] as string)
    expect(url.searchParams.get('street')).toBe('443 CO 105')
    expect(highwayAddress.street_1).toBe('443 Highway 105')
  })

  it('skips an unverified first candidate and returns a verified result', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ features: [] }),
        })
        .mockResolvedValue({
          ok: true,
          json: async () => [
            {
              ...exactCandidate,
              address: {
                city: 'Monument',
                state: 'Colorado',
                postcode: '80132',
              },
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
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ features: [] }),
        })
        .mockResolvedValue({
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
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('Colorado address points', () => {
  const point = {
    AddrFull: '123 N MAIN ST',
    PlaceName: 'MONUMENT',
    Zipcode: '80132',
    Latitude: 39.1001,
    Longitude: -104.8501,
  }
  function reply(features: unknown[], extra = {}) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: features.map((attributes) => ({ attributes })),
          ...extra,
        }),
      }),
    )
  }
  it('uses an exact official point without calling the fallback provider', async () => {
    reply([point])
    await expect(forwardGeocodeAddress(submitted)).resolves.toMatchObject({
      lat: point.Latitude,
      lng: point.Longitude,
      source: 'colorado-state-address-point',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('rejects wrong houses, roads, localities, empty coordinates and truncated results', async () => {
    for (const bad of [
      { ...point, AddrFull: '124 N MAIN ST' },
      { ...point, AddrFull: '123 N SECOND ST' },
      { ...point, PlaceName: 'DENVER', Zipcode: '80202' },
      { ...point, Latitude: null },
      { ...point, Latitude: 0 },
    ]) {
      reply([bad])
      await expect(coloradoAddressPoint(submitted)).resolves.toBeNull()
    }
    reply([point], { exceededTransferLimit: true })
    await expect(coloradoAddressPoint(submitted)).resolves.toBeNull()
  })
  it('rejects conflicting locations for the same address', async () => {
    reply([point, { ...point, Latitude: point.Latitude + 0.01 }])
    await expect(coloradoAddressPoint(submitted)).resolves.toBeNull()
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
