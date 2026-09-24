import { describe, it, expect } from 'vitest'
import { coverageBucket, propertyForUrl } from './gsc-index-sweep'
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

describe('coverageBucket', () => {
  it('groups pages Google knows about but has not indexed yet', () => {
    expect(coverageBucket('Discovered - currently not indexed')).toBe('waiting')
    expect(coverageBucket('Crawled - currently not indexed')).toBe('waiting')
  })

  it('groups indexed pages', () => {
    expect(coverageBucket('Submitted and indexed')).toBe('indexed')
    expect(coverageBucket('Indexed, not submitted in sitemap')).toBe('indexed')
  })

  it('groups unknown, redirected, excluded, and empty statuses as other', () => {
    expect(coverageBucket('URL is unknown to Google')).toBe('other')
    expect(coverageBucket('Page with redirect')).toBe('other')
    expect(coverageBucket('Excluded by ‘noindex’ tag')).toBe('other')
    expect(coverageBucket(null)).toBe('other')
  })
})
