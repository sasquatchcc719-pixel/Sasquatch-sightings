import { describe, it, expect } from 'vitest'
import { propertyForUrl, isPingable } from './gsc-index-sweep'
import { GSC_WWW_PROPERTY, GSC_SIGHTINGS_PROPERTY } from './gsc'

describe('propertyForUrl', () => {
  it('maps www + proxied job pages to the www property', () => {
    expect(propertyForUrl('https://www.sasquatchcarpet.com/services/x')).toBe(
      GSC_WWW_PROPERTY,
    )
    expect(
      propertyForUrl('https://www.sasquatchcarpet.com/sightings/monument/abc'),
    ).toBe(GSC_WWW_PROPERTY)
  })

  it('maps the sightings subdomain to the sightings property', () => {
    expect(
      propertyForUrl('https://sightings.sasquatchcarpet.com/work/monument/abc'),
    ).toBe(GSC_SIGHTINGS_PROPERTY)
  })
})

describe('isPingable', () => {
  it('pings crawl-budget-starved pages (not indexed)', () => {
    expect(isPingable('Discovered - currently not indexed')).toBe(true)
    expect(isPingable('Crawled - currently not indexed')).toBe(true)
  })

  it('skips already-indexed pages', () => {
    expect(isPingable('Submitted and indexed')).toBe(false)
    expect(isPingable('Indexed, not submitted in sitemap')).toBe(false)
  })

  it('skips hard problems a ping cannot fix', () => {
    expect(isPingable('Page with redirect')).toBe(false)
    expect(isPingable('Blocked by robots.txt')).toBe(false)
    expect(isPingable('Excluded by ‘noindex’ tag')).toBe(false)
    expect(isPingable('Not found (404)')).toBe(false)
  })

  it('handles null/empty coverage safely', () => {
    expect(isPingable(null)).toBe(false)
    expect(isPingable('')).toBe(false)
  })
})
