import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  fetchOrganicRanks: vi.fn(),
  fetchMapsLocalFinder: vi.fn(),
}))

vi.mock('@/supabase/server', () => ({
  createAdminClient: mocks.createAdminClient,
}))

vi.mock('@/lib/dataforseo', () => ({
  fetchOrganicRanks: mocks.fetchOrganicRanks,
  fetchMapsLocalFinder: mocks.fetchMapsLocalFinder,
}))

import { runRadarScan } from './radar-scan'

const keywords = [
  { id: 'monument', keyword: 'carpet cleaning', location: 'Monument, CO' },
  { id: 'palmer', keyword: 'carpet cleaning', location: 'Palmer Lake, CO' },
]

const domains = [
  {
    id: 'sasquatch',
    domain: 'sasquatchcarpet.com',
    display_name: 'Sasquatch Carpet Cleaning',
    is_my_domain: true,
  },
  {
    id: 'competitor',
    domain: 'example.com',
    display_name: 'Example',
    is_my_domain: false,
  },
]

function supabaseFake() {
  let run = 0
  return {
    from(table: string) {
      if (table === 'radar_keywords') {
        return {
          select: () => ({
            eq: async () => ({ data: keywords, error: null }),
          }),
        }
      }
      if (table === 'radar_domains') {
        return {
          select: async () => ({ data: domains, error: null }),
        }
      }
      if (table === 'radar_scan_runs') {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: { id: `run-${++run}` },
                error: null,
              }),
            }),
          }),
          delete: () => ({
            eq: async () => ({ error: null }),
          }),
        }
      }
      return {
        insert: async () => ({ error: null }),
      }
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createAdminClient.mockReturnValue(supabaseFake())
  mocks.fetchOrganicRanks.mockImplementation(async (_keyword, location) => ({
    ranks: [
      { domain_id: 'sasquatch', rank_position: 4 },
      { domain_id: 'competitor', rank_position: null },
    ],
    snapshot: [{ domain: 'sasquatchcarpet.com', position: 4 }],
    requestedDepth: 50,
    returnedDepth: 48,
    taskId: `task-${location}`,
    cost: 0.01,
    device: 'desktop',
    lat: 39,
    lng: -104,
  }))
  mocks.fetchMapsLocalFinder.mockResolvedValue({
    mapPack: [
      {
        position: 1,
        title: 'Sasquatch Carpet Cleaning',
        domain: 'sasquatchcarpet.com',
        rating: 5,
        reviews: 112,
        address: '740 Platte Ln',
      },
    ],
    ranksByDomainId: new Map([['sasquatch', 1]]),
  })
})

describe('runRadarScan completion', () => {
  it('marks a run successful only when every town and ranking row completes', async () => {
    const result = await runRadarScan()

    expect(result).toMatchObject({
      success: true,
      keywords_processed: 2,
      keywords_succeeded: 2,
      keywords_failed: 0,
      rankings_inserted: 4,
    })
  })

  it('surfaces a partial provider failure instead of reporting success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.fetchOrganicRanks.mockImplementation(async (_keyword, location) => {
      if (location === 'Palmer Lake, CO') throw new Error('provider timed out')
      return {
        ranks: [
          { domain_id: 'sasquatch', rank_position: 4 },
          { domain_id: 'competitor', rank_position: null },
        ],
        snapshot: [{ domain: 'sasquatchcarpet.com', position: 4 }],
        requestedDepth: 50,
        returnedDepth: 48,
        taskId: 'task-monument',
        cost: 0.01,
        device: 'desktop',
        lat: 39,
        lng: -104,
      }
    })

    const result = await runRadarScan()

    expect(result).toMatchObject({
      success: false,
      keywords_processed: 2,
      keywords_succeeded: 1,
      keywords_failed: 1,
      rankings_inserted: 2,
    })
    expect(result.error_detail).toContain('Palmer Lake, CO: provider timed out')
  })
})
