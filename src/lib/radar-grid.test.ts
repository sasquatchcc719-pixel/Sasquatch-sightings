import { describe, it, expect } from 'vitest'
import {
  buildGrid,
  buildAreaGrid,
  computeStats,
  distanceToPolygonMiles,
  estimateGridCost,
  findMyRank,
  pointInPolygon,
  polygonBbox,
  DEFAULT_GRID,
  SERVICE_AREA_POLYGON,
} from './radar-grid'
import type { SerpMapPackPlace } from './serpApi'

const place = (
  position: number,
  title: string,
  domain: string | null = null,
): SerpMapPackPlace => ({
  position,
  title,
  domain,
  rating: null,
  reviews: null,
  address: null,
  place_id: null,
  lat: null,
  lng: null,
})

describe('buildGrid', () => {
  it('produces size x size points', () => {
    expect(buildGrid(39.0908, -104.8698, 5, 1.5)).toHaveLength(25)
    expect(buildGrid(39.0908, -104.8698, 3, 1)).toHaveLength(9)
  })

  it('centres the middle point on the given coordinate', () => {
    const g = buildGrid(39.0908, -104.8698, 5, 1.5)
    const mid = g.find((p) => p.row === 2 && p.col === 2)!
    expect(mid.lat).toBeCloseTo(39.0908, 6)
    expect(mid.lng).toBeCloseTo(-104.8698, 6)
  })

  it('puts row 0 north of the last row', () => {
    const g = buildGrid(39.0908, -104.8698, 5, 1.5)
    const north = g.find((p) => p.row === 0 && p.col === 0)!
    const south = g.find((p) => p.row === 4 && p.col === 0)!
    expect(north.lat).toBeGreaterThan(south.lat)
  })

  it('spaces latitude by the requested miles', () => {
    const g = buildGrid(39.0908, -104.8698, 3, 1.5)
    const a = g.find((p) => p.row === 0 && p.col === 1)!
    const b = g.find((p) => p.row === 1 && p.col === 1)!
    // 1.5 miles / 69 miles-per-degree
    expect(a.lat - b.lat).toBeCloseTo(1.5 / 69, 6)
  })

  it('widens longitude spacing to compensate for latitude convergence', () => {
    // At 39N a degree of longitude is ~78% of a degree of latitude, so the
    // longitude STEP must be larger to cover the same ground distance.
    const g = buildGrid(39.0908, -104.8698, 3, 1.5)
    const mid = g.find((p) => p.row === 1 && p.col === 1)!
    const east = g.find((p) => p.row === 1 && p.col === 2)!
    const north = g.find((p) => p.row === 0 && p.col === 1)!
    const dLng = east.lng - mid.lng
    const dLat = north.lat - mid.lat
    expect(dLng).toBeGreaterThan(dLat)
  })
})

describe('findMyRank', () => {
  it('matches on business name', () => {
    expect(
      findMyRank([place(1, 'King Organic Clean'), place(4, 'Sasquatch Carpet Cleaning')]),
    ).toBe(4)
  })

  it('matches case-insensitively and on partial titles', () => {
    expect(findMyRank([place(2, 'SASQUATCH CARPET CLEANING LLC')])).toBe(2)
  })

  it('falls back to the domain when the name differs', () => {
    expect(findMyRank([place(7, 'Sasquatch', 'sasquatchcarpet.com')])).toBe(7)
  })

  it('ignores a www prefix on the domain', () => {
    expect(findMyRank([place(3, 'Something Else', 'www.sasquatchcarpet.com')])).toBe(3)
  })

  it('returns null when we are absent', () => {
    expect(findMyRank([place(1, 'King Organic Clean'), place(2, 'Voda')])).toBeNull()
  })

  it('returns null for an empty pack', () => {
    expect(findMyRank([])).toBeNull()
  })
})

describe('computeStats', () => {
  it('averages only the points where we ranked', () => {
    const s = computeStats([1, 3, null, null, 5])
    expect(s.avgRank).toBe(3) // (1+3+5)/3 — misses are NOT counted as 21
    expect(s.ranked).toBe(3)
  })

  it('measures visibility against every scanned point, not just ranked ones', () => {
    // 2 of 4 points in the top 3
    expect(computeStats([1, 2, null, 9]).visibilityPct).toBe(50)
  })

  it('treats a total miss as zero visibility and null ARP', () => {
    const s = computeStats([null, null, null])
    expect(s.avgRank).toBeNull()
    expect(s.visibilityPct).toBe(0)
    expect(s.ranked).toBe(0)
  })

  it('handles an empty scan without dividing by zero', () => {
    const s = computeStats([])
    expect(s.avgRank).toBeNull()
    expect(s.visibilityPct).toBe(0)
  })

  it('counts rank 3 as visible and rank 4 as not', () => {
    expect(computeStats([3]).visibilityPct).toBe(100)
    expect(computeStats([4]).visibilityPct).toBe(0)
  })
})

describe('pointInPolygon', () => {
  const square: Array<[number, number]> = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ]

  it('accepts a point in the middle', () => {
    expect(pointInPolygon(0, 0, square)).toBe(true)
  })

  it('rejects points outside on every side', () => {
    expect(pointInPolygon(2, 0, square)).toBe(false)
    expect(pointInPolygon(-2, 0, square)).toBe(false)
    expect(pointInPolygon(0, 2, square)).toBe(false)
    expect(pointInPolygon(0, -2, square)).toBe(false)
  })

  it('puts Monument and Colorado Springs inside the service area', () => {
    expect(pointInPolygon(39.0908, -104.8698, SERVICE_AREA_POLYGON)).toBe(true)
    expect(pointInPolygon(38.8339, -104.8214, SERVICE_AREA_POLYGON)).toBe(true)
    expect(pointInPolygon(39.1152, -104.9178, SERVICE_AREA_POLYGON)).toBe(true)
  })

  it('excludes places we do not serve', () => {
    expect(pointInPolygon(39.7392, -104.9903, SERVICE_AREA_POLYGON)).toBe(false) // Denver
    expect(pointInPolygon(38.2544, -104.6091, SERVICE_AREA_POLYGON)).toBe(false) // Pueblo
    expect(pointInPolygon(39.0908, -105.4, SERVICE_AREA_POLYGON)).toBe(false) // far west
  })
})

describe('buildAreaGrid', () => {
  it('keeps every generated point inside the polygon', () => {
    const pts = buildAreaGrid(SERVICE_AREA_POLYGON, 3)
    expect(pts.length).toBeGreaterThan(0)
    for (const p of pts) {
      expect(pointInPolygon(p.lat, p.lng, SERVICE_AREA_POLYGON)).toBe(true)
    }
  })

  it('clips away a meaningful share of the bounding box', () => {
    const bb = polygonBbox(SERVICE_AREA_POLYGON)
    const spacing = 3
    const dLat = spacing / 69
    const midLat = (bb.minLat + bb.maxLat) / 2
    const dLng = spacing / (69 * Math.cos((midLat * Math.PI) / 180))
    const bboxCount =
      (Math.floor((bb.maxLat - bb.minLat) / dLat) + 1) *
      (Math.floor((bb.maxLng - bb.minLng) / dLng) + 1)
    const clipped = buildAreaGrid(SERVICE_AREA_POLYGON, spacing).length
    // Clipping is the whole point — it should save a real fraction of the spend.
    expect(clipped).toBeLessThan(bboxCount * 0.75)
  })

  it('gets denser as spacing shrinks', () => {
    const coarse = buildAreaGrid(SERVICE_AREA_POLYGON, 5).length
    const fine = buildAreaGrid(SERVICE_AREA_POLYGON, 2).length
    expect(fine).toBeGreaterThan(coarse * 2)
  })

  it('orders rows north to south', () => {
    const pts = buildAreaGrid(SERVICE_AREA_POLYGON, 5)
    const firstRow = Math.min(...pts.map((p) => p.row))
    const lastRow = Math.max(...pts.map((p) => p.row))
    const northMost = Math.max(...pts.filter((p) => p.row === firstRow).map((p) => p.lat))
    const southMost = Math.max(...pts.filter((p) => p.row === lastRow).map((p) => p.lat))
    expect(northMost).toBeGreaterThan(southMost)
  })

  it('spans Castle Rock down to Colorado Springs', () => {
    const pts = buildAreaGrid(SERVICE_AREA_POLYGON, 3)
    const lats = pts.map((p) => p.lat)
    expect(Math.max(...lats)).toBeGreaterThan(39.3) // Castle Rock latitude
    expect(Math.min(...lats)).toBeLessThan(38.9) // into Colorado Springs
  })

  it('edge buffer keeps outside points within the ring', () => {
    const tight = buildAreaGrid(SERVICE_AREA_POLYGON, 3, 0)
    const buffered = buildAreaGrid(SERVICE_AREA_POLYGON, 3, 3)
    expect(buffered.length).toBeGreaterThan(tight.length)
    const outside = buffered.filter(
      (p) => !pointInPolygon(p.lat, p.lng, SERVICE_AREA_POLYGON),
    )
    expect(outside.length).toBeGreaterThan(0)
    for (const p of outside) {
      expect(distanceToPolygonMiles(p.lat, p.lng, SERVICE_AREA_POLYGON)).toBeLessThanOrEqual(
        3.01,
      )
    }
  })
})

describe('estimateGridCost', () => {
  it('prices the tight grid at 25 searches', () => {
    expect(estimateGridCost('tri-lakes')).toBe(25)
  })

  it('prices the service area well under the 250 free tier at 3 mi', () => {
    const n = estimateGridCost('service-area', 3)
    expect(n).toBeGreaterThan(40)
    expect(n).toBeLessThan(100)
  })

  it('costs more as resolution increases', () => {
    expect(estimateGridCost('service-area', 2)).toBeGreaterThan(
      estimateGridCost('service-area', 4),
    )
  })
})

describe('DEFAULT_GRID', () => {
  it('is centred on Monument, the contested town', () => {
    expect(DEFAULT_GRID.centerLat).toBeCloseTo(39.0908, 4)
    expect(DEFAULT_GRID.centerLng).toBeCloseTo(-104.8698, 4)
  })

  it('costs 25 SerpApi calls per run', () => {
    expect(DEFAULT_GRID.size ** 2).toBe(25)
  })
})
