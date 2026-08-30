import { describe, expect, it } from 'vitest'
import {
  appleDirectionsHref,
  appleSearchHref,
  formatServiceAddress,
  googleDirectionsHref,
  googleSearchHref,
  streetViewSrc,
} from './address-links'

const ADDRESS = {
  street_1: '123 Red Rock Ln',
  city: 'Monument',
  state: 'CO',
  zip_code: '80132',
}

describe('address links', () => {
  // These assertions pin the exact URLs that were previously built inline.
  // Changing them changes where a tech ends up driving.
  it('formats the address the way the admin screens always have', () => {
    expect(formatServiceAddress(ADDRESS)).toBe('123 Red Rock Ln, Monument, CO 80132')
  })

  it('builds directions links', () => {
    expect(googleDirectionsHref(formatServiceAddress(ADDRESS))).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=123%20Red%20Rock%20Ln%2C%20Monument%2C%20CO%2080132',
    )
    expect(appleDirectionsHref(formatServiceAddress(ADDRESS))).toBe(
      'https://maps.apple.com/?daddr=123%20Red%20Rock%20Ln%2C%20Monument%2C%20CO%2080132&dirflg=d',
    )
  })

  it('builds pin-drop links for the tech screen', () => {
    expect(googleSearchHref('123 Red Rock Ln, Monument, CO, 80132')).toBe(
      'https://www.google.com/maps/search/?api=1&query=123%20Red%20Rock%20Ln%2C%20Monument%2C%20CO%2C%2080132',
    )
    expect(appleSearchHref('123 Red Rock Ln, Monument, CO, 80132')).toBe(
      'https://maps.apple.com/?q=123%20Red%20Rock%20Ln%2C%20Monument%2C%20CO%2C%2080132',
    )
  })

  it('proxies Street View so the API key stays server-side', () => {
    expect(streetViewSrc(formatServiceAddress(ADDRESS))).toBe(
      '/api/admin/streetview?address=123%20Red%20Rock%20Ln%2C%20Monument%2C%20CO%2080132',
    )
  })

  it('tolerates a half-filled address without throwing', () => {
    expect(formatServiceAddress({ street_1: '5 Elk Rd', city: 'Larkspur' })).toBe(
      '5 Elk Rd, Larkspur,  ',
    )
  })
})
