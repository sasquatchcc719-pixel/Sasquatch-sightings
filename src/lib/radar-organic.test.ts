import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ primary: vi.fn(), verify: vi.fn() }))
vi.mock('@/lib/dataforseo', () => ({ fetchOrganicRanks: mocks.primary }))
vi.mock('@/lib/serpapi-budget', () => ({ fetchSerpApiJson: mocks.verify }))
import { fetchAuditedOrganicRanks } from './radar-organic'
import {
  describeOrganicObservation,
  organicObservation,
} from './radar-organic-evidence'
const domains = [
  {
    id: 'ours',
    domain: 'sasquatchcarpet.com',
    display_name: 'Sasquatch',
    is_my_domain: true,
  },
]
function primary(rank: number | null) {
  return {
    ranks: [{ domain_id: 'ours', rank_position: rank }],
    snapshot: rank
      ? [
          {
            domain: 'sasquatchcarpet.com',
            position: rank,
            url: 'https://www.sasquatchcarpet.com/',
          },
        ]
      : [],
    requestedDepth: 50,
    returnedDepth: 47,
    taskId: 'dfs-task',
    cost: 0.01,
  }
}
function verification(rank: number | null) {
  return {
    search_metadata: { status: 'Success', id: 'verify-task' },
    search_parameters: { location_used: 'Monument,Colorado,United States' },
    organic_results: [
      { position: 9, link: 'https://example.com/' },
      ...(rank
        ? [
            {
              position: rank,
              link: 'https://www.sasquatchcarpet.com/',
              title: 'Sasquatch',
            },
          ]
        : []),
    ],
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.primary.mockResolvedValue(primary(null))
  mocks.verify.mockResolvedValue(verification(1))
})
describe('audited organic measurements', () => {
  it('repairs the reproduced false miss with independent #1 and saves both sources', async () => {
    const result = await fetchAuditedOrganicRanks(
      'carpet cleaning',
      'Monument, Colorado, United States',
      domains,
    )
    expect(result.ranks[0].rank_position).toBe(1)
    expect(result.audit.observations.ours).toEqual({
      status: 'checked',
      source: 'serpapi',
      rank: 1,
      depth: 9,
    })
    expect(result.audit.primary).toMatchObject({ taskId: 'dfs-task' })
    expect(result.audit.verification).toMatchObject({
      taskId: 'verify-task',
      returnedDepth: 9,
    })
    expect(mocks.verify.mock.calls[0][0].params.has('num')).toBe(false)
  })
  it.each([16, 25, 50])(
    'preserves the deeper observed #%i when the first-page check misses it',
    async (rank) => {
      mocks.primary.mockResolvedValue(primary(rank))
      mocks.verify.mockResolvedValue(verification(null))
      const result = await fetchAuditedOrganicRanks(
        'carpet cleaning',
        'Monument, CO',
        domains,
      )
      expect(result.ranks[0].rank_position).toBe(rank)
      expect(result.audit.observations.ours.status).toBe('observed')
      expect(
        describeOrganicObservation(result.audit.observations.ours),
      ).toContain('not independently verified')
    },
  )
  it('scopes two misses to the actual first-page depth and never fabricates rank 51', async () => {
    mocks.verify.mockResolvedValue(verification(null))
    const result = await fetchAuditedOrganicRanks(
      'carpet cleaning',
      'Monument, CO',
      domains,
    )
    expect(result.ranks[0].rank_position).toBeNull()
    expect(describeOrganicObservation(result.audit.observations.ours)).toBe(
      'not seen in 9 checked · deeper rank unknown',
    )
  })
  it('keeps a quota failure unknown instead of declaring a lost ranking', async () => {
    mocks.verify.mockRejectedValue(new Error('quota exhausted'))
    const result = await fetchAuditedOrganicRanks(
      'carpet cleaning',
      'Monument, CO',
      domains,
    )
    expect(result.audit.observations.ours.status).toBe('unverified')
    expect(result.audit.errors).toHaveLength(1)
  })
  it('survives the deeper provider failing when independent evidence succeeds', async () => {
    mocks.primary.mockRejectedValue(new Error('timeout'))
    const result = await fetchAuditedOrganicRanks(
      'carpet cleaning',
      'Monument, CO',
      domains,
    )
    expect(result.ranks[0].rank_position).toBe(1)
    expect(result.audit.observations.ours.status).toBe('checked')
  })
  it.each(['empty', 'wrong location', 'provider error'])(
    'rejects an invalid independent response: %s',
    async (failure) => {
      const payload = verification(null)
      if (failure === 'empty') payload.organic_results = []
      if (failure === 'wrong location')
        payload.search_parameters.location_used =
          'Denver, Colorado, United States'
      if (failure === 'provider error') payload.search_metadata.status = 'Error'
      mocks.verify.mockResolvedValue(payload)
      const result = await fetchAuditedOrganicRanks(
        'carpet cleaning',
        'Monument, CO',
        domains,
      )
      expect(result.audit.observations.ours.status).toBe('unverified')
      expect(result.audit.observations.ours.depth).toBe(0)
    },
  )
  it('does not upgrade unaudited legacy history to a verified observation', () => {
    expect(organicObservation(null, 'ours').status).toBe('unverified')
  })
})
