import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@/lib/serpapi-budget', () => ({ fetchSerpApiJson: mocks.fetch }))
import {
  fetchAuditedOrganicRanks,
  isRelevantOrganicPage,
  townOrganicQuery,
} from './radar-organic'
const domains = [
  {
    id: 'ours',
    domain: 'sasquatchcarpet.com',
    display_name: 'Sasquatch',
    is_my_domain: true,
  },
]
function page(own = false) {
  return {
    search_metadata: { status: 'Success' },
    search_parameters: {
      q: 'carpet cleaning monument co',
      location_used: 'Monument,Colorado,United States',
    },
    organic_results: [
      {
        position: 1,
        link: 'https://example.com/monument-carpet-cleaning',
        title: 'Carpet cleaning Monument',
      },
      {
        position: 2,
        link: 'https://other.test/monument-carpet-cleaning',
        title: 'Monument carpet cleaning',
      },
      ...(own
        ? [
            {
              position: 3,
              link: 'https://www.sasquatchcarpet.com/',
              title: 'Monument carpet cleaning',
            },
          ]
        : []),
    ],
    serpapi_pagination: { next: 'next' },
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetch.mockResolvedValue(page(true))
})
describe('comparable town organic searches', () => {
  it('records explicit query and exact first-page position', async () => {
    const r = await fetchAuditedOrganicRanks(
      'carpet cleaning',
      'Monument, CO',
      domains,
      { deep: false },
    )
    expect(r.audit).toMatchObject({
      version: 2,
      query: 'carpet cleaning monument co',
    })
    expect(r.ranks[0].rank_position).toBe(3)
    expect(mocks.fetch.mock.calls[0][0].params.get('q')).toBe(
      'carpet cleaning monument co',
    )
  })
  it('does not repeat a town already present in the configured query', () => {
    expect(townOrganicQuery('carpet cleaning monument co', 'Monument,CO')).toBe(
      'carpet cleaning monument co',
    )
  })
  it('rejects unrelated household cleaning despite matching location metadata', async () => {
    const p = page()
    p.organic_results = p.organic_results.map((r) => ({
      ...r,
      title: 'General cleaning',
      link: 'https://example.org/cleaning',
    }))
    mocks.fetch.mockResolvedValue(p)
    const r = await fetchAuditedOrganicRanks(
      'carpet cleaning',
      'Monument,CO',
      domains,
      { deep: false },
    )
    expect(r.audit.observations.ours.status).toBe('unverified')
    expect(r.audit.errors).toHaveLength(1)
  })
  it('accepts literal percent signs in legitimate service snippets', () => {
    const p = page(true)
    p.organic_results[0].title = 'Monument carpet cleaning 100% satisfaction'
    expect(
      isRelevantOrganicPage(p, 'carpet cleaning monument co', 'Monument,CO'),
    ).toBe(true)
  })
  it('rejects the reproduced wrong-city response', () => {
    const p = page()
    p.organic_results = p.organic_results.map((r) => ({
      ...r,
      title: 'Denver carpet cleaning',
      link: 'https://example.org/denver-carpet-cleaning',
    }))
    expect(
      isRelevantOrganicPage(p, 'carpet cleaning monument co', 'Monument,CO'),
    ).toBe(false)
  })
  it('rejects a provider response for a different query', () => {
    const p = page()
    p.search_parameters.q = 'carpet'
    expect(
      isRelevantOrganicPage(p, 'carpet cleaning monument co', 'Monument,CO'),
    ).toBe(false)
  })
  it('finds an exact deeper rank through actual pagination', async () => {
    mocks.fetch.mockResolvedValueOnce(page()).mockResolvedValueOnce({
      ...page(true),
      organic_results: [
        {
          position: 1,
          link: 'https://www.sasquatchcarpet.com/',
          title: 'Monument carpet cleaning',
        },
      ],
    })
    const r = await fetchAuditedOrganicRanks(
      'carpet cleaning',
      'Monument,CO',
      domains,
      { deep: true },
    )
    expect(r.ranks[0].rank_position).toBe(11)
    expect(mocks.fetch.mock.calls[1][0].params.get('start')).toBe('10')
    expect(r.audit.observations.ours.status).toBe('checked')
  })
  it('rejects repeated pagination without inventing an outside-top50 position', async () => {
    mocks.fetch.mockResolvedValue(page())
    const r = await fetchAuditedOrganicRanks(
      'carpet cleaning',
      'Monument,CO',
      domains,
      { deep: true },
    )
    expect(r.ranks[0].rank_position).toBeNull()
    expect(r.returnedDepth).toBe(2)
    expect(r.audit.errors).toContain('Search repeated an earlier page')
  })
  it('keeps quota failure as unknown', async () => {
    mocks.fetch.mockRejectedValue(new Error('quota'))
    const r = await fetchAuditedOrganicRanks(
      'carpet cleaning',
      'Monument,CO',
      domains,
    )
    expect(r.audit.observations.ours.status).toBe('unverified')
    expect(r.ranks[0].rank_position).toBeNull()
  })
})
