// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  historical: vi.fn(),
  map: vi.fn(),
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('next/cache', () => ({ unstable_noStore: vi.fn() }))
vi.mock('@/lib/public-job-coverage.server', () => ({
  loadHistoricalJobPins: mocks.historical,
}))
vi.mock('@/components/public/MapView', () => ({ MapView: mocks.map }))
vi.mock('@/components/public/ContactSection', () => ({
  ContactSection: () => null,
}))
vi.mock('@/components/admin-link', () => ({ AdminLink: () => null }))
import Home from './page'
import sitemap from './sitemap'
import { generateMetadata as sightingMetadata } from './sightings/share/[id]/page'
import { generateMetadata as jobMetadata } from './work/[city]/[slug]/page'
import { GET as publicJobs } from './api/public/jobs/route'

const job = {
  id: 'job-1',
  slug: 'completed-cleaning',
  city: 'Monument',
  image_url: '/photo.jpg',
  gps_lat: 39,
  gps_lng: -105,
  gps_fuzzy_lat: 39.001,
  gps_fuzzy_lng: -105.001,
  ops_invoice_id: 'private-invoice',
  invoice_amount: 999,
  raw_voice_input: 'private voice',
  email: 'private@example.test',
  ai_description: 'Completed carpet cleaning.',
  neighborhood: null,
  published_at: '2026-10-28T10:00:00Z',
  created_at: '2026-10-28T10:00:00Z',
  service: [
    {
      name: 'Carpet Cleaning',
      slug: 'carpet-cleaning',
      private_field: 'private',
    },
  ],
}
const sighting = {
  id: 'sighting-1',
  image_url: '/sighting.jpg',
  gps_lat: 39.2,
  gps_lng: -105.2,
  city: 'Monument',
  state: 'CO',
  created_at: '2026-10-28T10:00:00Z',
  full_name: 'Private Person',
  email: 'private@example.test',
  phone_number: 'private',
  coupon_code: 'private',
}
let serviceShape: unknown
beforeEach(() => {
  vi.resetAllMocks()
  serviceShape = job.service
  mocks.historical.mockResolvedValue([])
  mocks.admin.mockReturnValue({
    from: (table: string) => {
      const rows = table === 'jobs' ? [{ ...job, service: serviceShape }] : [sighting]
      const query = {
        select: (fields: string) => {
          mocks.select(table, fields)
          return query
        },
        eq: (field: string, value: unknown) => {
          mocks.eq(table, field, value)
          return query
        },
        order: () => query,
        limit: () => query,
        not: () => query,
        single: async () => ({ data: rows[0], error: null }),
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve(resolve({ data: rows, error: null })),
      }
      return query
    },
  })
})

function mapProps(node: unknown): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object') return
  const element = node as ReactElement<{ children?: unknown }>
  if (element.type === mocks.map)
    return element.props as Record<string, unknown>
  for (const child of [element.props?.children].flat()) {
    const found = mapProps(child)
    if (found) return found
  }
}

describe('public server data is projected before reaching the browser', () => {
  it.each([
    ['object', { name: 'Carpet Cleaning', private_field: 'private' }, [{ name: 'Carpet Cleaning' }]],
    ['array', [{ name: 'Carpet Cleaning', private_field: 'private' }], [{ name: 'Carpet Cleaning' }]],
    ['missing', null, []],
  ])('preserves public map rendering with a %s service relation', async (_shape, service, expected) => {
    serviceShape = service
    const props = mapProps(await Home())!
    expect((props.jobs as Array<{ service: unknown }>)[0].service).toEqual(expected)
    expect(JSON.stringify(props)).not.toContain('private')
  })

  it('keeps internal job coordinates/invoice IDs out of map props and drops contact data', async () => {
    const tree = await Home()
    expect(mocks.historical).toHaveBeenCalledWith([job])
    const props = mapProps(tree)!
    expect(props.jobs).toEqual([
      {
        id: job.id,
        slug: job.slug,
        city: job.city,
        image_url: job.image_url,
        gps_fuzzy_lat: job.gps_fuzzy_lat,
        gps_fuzzy_lng: job.gps_fuzzy_lng,
        service: [{ name: 'Carpet Cleaning' }],
      },
    ])
    expect(props.sightings).toEqual([
      {
        id: sighting.id,
        image_url: sighting.image_url,
        gps_lat: sighting.gps_lat,
        gps_lng: sighting.gps_lng,
        created_at: sighting.created_at,
      },
    ])
    expect(JSON.stringify(props)).not.toContain('private')
    expect(mocks.eq).toHaveBeenCalledWith('jobs', 'status', 'published')
  })

  it('serves public job cards without raw GPS, contact or financial fields', async () => {
    const response = await publicJobs(
      new NextRequest('https://example.test/api/public/jobs'),
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.jobs[0].id).toBe(job.id)
    expect(JSON.stringify(data)).not.toContain('private')
    expect(data.jobs[0]).not.toHaveProperty('gps_lat')
    expect(data.jobs[0]).not.toHaveProperty('gps_fuzzy_lat')
    expect(mocks.eq).toHaveBeenCalledWith('jobs', 'status', 'published')
  })

  it('keeps public share/detail metadata and sitemap functional with server-only table access', async () => {
    const shared = await sightingMetadata({
      params: Promise.resolve({ id: sighting.id }),
    })
    const detail = await jobMetadata({
      params: Promise.resolve({ city: 'monument', slug: job.slug }),
    })
    const links = await sitemap()
    expect(shared.title).toContain('Monument')
    expect(detail.title).toContain('Carpet Cleaning')
    expect(links.some((link) => link.url.includes(job.slug))).toBe(true)
    expect(links.some((link) => link.url.includes(sighting.id))).toBe(true)
    expect(JSON.stringify([shared, detail, links])).not.toContain('private')
    for (const [, fields] of mocks.select.mock.calls) {
      expect(fields).not.toContain('*')
      expect(fields).not.toMatch(
        /full_name|phone_number|coupon_code|invoice_amount|raw_voice_input/,
      )
    }
  })
})
