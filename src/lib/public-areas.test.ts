import { describe, expect, it } from 'vitest'
import { PUBLIC_AREAS, areaPagesForJob, servicePageUrl } from './public-areas'

describe('areaPagesForJob', () => {
  it('links a Castle Rock job to the Castle Rock page', () => {
    const { city, neighborhood } = areaPagesForJob({
      city: 'Castle Rock',
      gps_fuzzy_lat: 39.37,
      gps_fuzzy_lng: -104.86,
    })
    expect(city?.pageUrl).toBe(
      'https://www.sasquatchcarpet.com/service-areas/castle-rock',
    )
    expect(neighborhood).toBeNull()
  })

  it('resolves misspelled cities by GPS', () => {
    expect(
      areaPagesForJob({
        city: 'Monumnet',
        gps_fuzzy_lat: 39.09,
        gps_fuzzy_lng: -104.87,
      }).city?.name,
    ).toBe('Monument')
    expect(
      areaPagesForJob({
        city: 'Colordo Springs',
        gps_fuzzy_lat: 38.84,
        gps_fuzzy_lng: -104.82,
      }).city?.name,
    ).toBe('Colorado Springs')
  })

  it('adds the neighborhood page for Colorado Springs jobs inside one', () => {
    const { city, neighborhood } = areaPagesForJob({
      city: 'Colorado Springs',
      gps_fuzzy_lat: 38.905,
      gps_fuzzy_lng: -104.87,
    })
    expect(city?.name).toBe('Colorado Springs')
    expect(neighborhood?.pageUrl).toBe(
      'https://www.sasquatchcarpet.com/carpet-cleaning-rockrimmon-colorado-springs',
    )
  })

  it('prefers the neighborhood named on the job over GPS', () => {
    const { neighborhood } = areaPagesForJob({
      city: 'Colorado Springs',
      neighborhood: 'Wolf Ranch',
      gps_fuzzy_lat: 38.95,
      gps_fuzzy_lng: -104.78,
    })
    expect(neighborhood?.name).toBe('Cordera & Wolf Ranch')
  })

  it('never attaches a neighborhood outside Colorado Springs', () => {
    expect(
      areaPagesForJob({
        city: 'Monument',
        gps_fuzzy_lat: 39.0075,
        gps_fuzzy_lng: -104.76,
      }).neighborhood,
    ).toBeNull()
  })

  it('returns no page for places without one', () => {
    expect(
      areaPagesForJob({
        city: 'Littleton',
        gps_fuzzy_lat: 39.61,
        gps_fuzzy_lng: -105.02,
      }).city,
    ).toBeNull()
  })
})

describe('PUBLIC_AREAS', () => {
  it('defines every area the website requests', () => {
    for (const area of [
      'black-forest',
      'briargate',
      'castle-pines',
      'castle-rock',
      'colorado-springs',
      'cordera-wolf-ranch',
      'falcon',
      'flying-horse',
      'gleneagle',
      'kissing-camels',
      'larkspur',
      'monument',
      'mountain-shadows',
      'palmer-lake',
      'rockrimmon',
      'woodmoor',
    ]) {
      expect(PUBLIC_AREAS[area], area).toBeDefined()
    }
  })
})

describe('servicePageUrl', () => {
  it('maps database service slugs to website service pages', () => {
    expect(servicePageUrl('standard-carpet-cleaning')).toBe(
      'https://www.sasquatchcarpet.com/services/maintenance-clean',
    )
    expect(servicePageUrl('deep-carpet-restoration')).toBe(
      'https://www.sasquatchcarpet.com/services/deep-carpet-cleaning',
    )
  })

  it('falls back to the services index', () => {
    expect(servicePageUrl(null)).toBe(
      'https://www.sasquatchcarpet.com/services',
    )
  })
})
