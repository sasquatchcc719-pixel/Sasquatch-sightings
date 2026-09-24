import { describe, expect, it } from 'vitest'
import { buildJobUrl } from './google-indexing'

describe('buildJobUrl', () => {
  it('builds the www proxy URL with a slugged city', () => {
    expect(buildJobUrl('Palmer Lake', 'some-job-slug')).toBe(
      'https://www.sasquatchcarpet.com/sightings/palmer-lake/some-job-slug',
    )
  })
})
