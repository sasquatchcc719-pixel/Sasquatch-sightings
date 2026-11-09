import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GridHeatMap } from './GridHeatMap'

vi.mock('mapbox-gl', () => ({ default: {
  Map: class { addControl() {} on() {} remove() {} },
  NavigationControl: class {},
} }))
beforeEach(() => vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'test-only'))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('GridHeatMap evidence labels', () => {
  it('does not turn missing scan data into zero visibility or encourage a scan while loading', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<GridHeatMap />)
    expect(screen.queryByText('0%')).toBeNull()
    expect(screen.getByText('Loading saved scans…')).toBeTruthy()
    expect(screen.getByText('no rank recorded')).toBeTruthy()
    expect(screen.queryByText('not in top 20')).toBeNull()
  })

  it('preserves a measured zero and explains ambiguous historical null ranks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ scans: [], points: [], scan: {
        id: 'scan-1', keyword: 'carpet cleaning', preset: 'service-area',
        points_total: 141, points_scanned: 141, points_ranked: 0,
        visibility_pct: 0, avg_rank: null, spacing_miles: 2,
        created_at: '2026-11-02T13:00:00Z',
      } }),
    }))
    render(<GridHeatMap />)
    await waitFor(() => expect(screen.getByText('0%')).toBeTruthy())
    expect(screen.getByText(/A missing rank is not proof/)).toBeTruthy()
  })
  it('keeps a saved null visibility unknown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ scans: [], points: [], scan: {
        id: 'scan-1', keyword: 'carpet cleaning', preset: 'service-area',
        points_total: 141, points_scanned: 0, points_ranked: 0,
        visibility_pct: null, avg_rank: null, spacing_miles: 2,
        created_at: '2026-11-02T13:00:00Z',
      } }),
    }))
    render(<GridHeatMap />)
    await waitFor(() => expect(screen.getByText('0/0')).toBeTruthy())
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('distinguishes a successful empty history from loading', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ scans: [], points: [], scan: null }),
    }))
    render(<GridHeatMap />)
    await waitFor(() => expect(screen.getByText('No saved scans')).toBeTruthy())
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('does not call a failed load an empty scan history', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, json: async () => ({ error: 'Saved history unavailable' }),
    }))
    render(<GridHeatMap />)
    await waitFor(() => expect(screen.getByText('Saved scans unavailable')).toBeTruthy())
    expect(screen.queryByText('No saved scans')).toBeNull()
  })

})
