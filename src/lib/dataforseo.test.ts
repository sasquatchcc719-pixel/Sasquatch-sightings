import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchOrganicRanks } from './dataforseo'
import type { RadarDomain } from './serpApi'

const domains: RadarDomain[] = [
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

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.DATAFORSEO_LOGIN
  delete process.env.DATAFORSEO_PASSWORD
})

describe('fetchOrganicRanks', () => {
  it('uses a real 50-deep crawl and stores misses as null', async () => {
    process.env.DATAFORSEO_LOGIN = 'login'
    process.env.DATAFORSEO_PASSWORD = 'password'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status_code: 20000,
          tasks: [
            {
              id: 'task-123',
              status_code: 20000,
              cost: 0.01,
              result: [
                {
                  items: [
                    {
                      type: 'local_pack',
                      rank_group: 1,
                      rank_absolute: 1,
                    },
                    {
                      type: 'organic',
                      rank_group: 16,
                      rank_absolute: 23,
                      page: 2,
                      url: 'https://www.sasquatchcarpet.com/',
                    },
                    {
                      type: 'organic',
                      rank_group: 48,
                      rank_absolute: 61,
                      page: 5,
                      url: 'https://last-result.test/',
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchOrganicRanks(
      'carpet cleaning',
      'monument, Colorado, United States',
      domains,
    )

    expect(result.requestedDepth).toBe(50)
    expect(result.returnedDepth).toBe(48)
    expect(result.taskId).toBe('task-123')
    expect(result.cost).toBe(0.01)
    expect(result.ranks).toEqual([
      { domain_id: 'sasquatch', rank_position: 16 },
      { domain_id: 'competitor', rank_position: null },
    ])
    expect(result.snapshot).toEqual([
      { domain: 'sasquatchcarpet.com', position: 16 },
      { domain: 'last-result.test', position: 48 },
    ])

    const [, request] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(request.body))[0]
    expect(body).toMatchObject({
      keyword: 'carpet cleaning',
      location_coordinate: '39.0908,-104.8698,500',
      device: 'desktop',
      depth: 50,
    })
  })
})
