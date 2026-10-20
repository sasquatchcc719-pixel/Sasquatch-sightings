import { afterEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveServiceAddress } from './addresses'
import { queueGeocodeForAddress } from './forward-geocode'

vi.mock('./forward-geocode', () => ({ queueGeocodeForAddress: vi.fn() }))
afterEach(() => vi.resetAllMocks())

it.each([true, false])(
  'finishes address geocoding before returning (existing: %s)',
  async (existing) => {
    const address = {
      id: 'address',
      street_1: '123 Main St',
      city: 'Monument',
      state: 'CO',
      zip_code: '80132',
    }
    let finish!: () => void
    vi.mocked(queueGeocodeForAddress).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const db = {
      from: () => ({
        select: () => ({
          eq: async () => ({ data: existing ? [address] : [], error: null }),
        }),
        insert: () => ({
          select: async () => ({ data: [address], error: null }),
        }),
      }),
    } as unknown as SupabaseClient
    let returned = false
    const result = resolveServiceAddress(db, 'customer', address).then(
      (value) => {
        returned = true
        return value
      },
    )
    await vi.waitFor(() =>
      expect(queueGeocodeForAddress).toHaveBeenCalledOnce(),
    )
    expect(returned).toBe(false)
    finish()
    await expect(result).resolves.toMatchObject({ id: 'address' })
  },
)
