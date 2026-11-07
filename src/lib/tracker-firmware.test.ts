import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
const mocks = vi.hoisted(() => ({ admin: vi.fn() }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
import { firmwareIdentity, firmwareReportSchema } from './tracker-firmware'
import { GET as image } from '@/app/api/devices/trackers/firmware/image/route'

describe('device firmware authorization', () => {
  beforeEach(() => vi.resetAllMocks())
  it.each([null, 'Bearer admin', 'Bearer ' + 'A'.repeat(64)])(
    'rejects malformed credentials before database access',
    async (header) => {
      const request = new Request('https://example.com', {
        headers: header ? { authorization: header } : {},
      })
      expect(await firmwareIdentity(request)).toBeNull()
      expect(mocks.admin).not.toHaveBeenCalled()
    },
  )
  it('only looks up an enabled owner of the bearer hash', async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    mocks.admin.mockReturnValue({ from: vi.fn().mockReturnValue(query) })
    const token = 'a'.repeat(64)
    expect(
      await firmwareIdentity(
        new Request('https://example.com', {
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
    ).toBeNull()
    expect(query.eq).toHaveBeenCalledWith('enabled', true)
    expect(query.eq).toHaveBeenCalledWith(
      'token_hash',
      createHash('sha256').update(token).digest('hex'),
    )
  })
  it('rejects cross-device release downloads before storage access', async () => {
    const tracker = { id: 'one' },
      release = { id: 'assigned', size: 10, storage_path: 'private.bin' }
    const query: any = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
      single: vi.fn(),
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    query.maybeSingle
      .mockResolvedValueOnce({ data: tracker })
      .mockResolvedValueOnce({ data: { release_id: 'assigned' } })
    query.single.mockResolvedValue({ data: release })
    const storage = { from: vi.fn() }
    mocks.admin.mockReturnValue({
      from: vi.fn().mockReturnValue(query),
      storage,
    })
    const response = await image(
      new Request('https://example.com/image?release=someone-elses', {
        headers: { authorization: `Bearer ${'a'.repeat(64)}` },
      }),
    )
    expect(response.status).toBe(404)
    expect(storage.from).not.toHaveBeenCalled()
    expect(query.eq).toHaveBeenCalledWith('tracker_id', 'one')
  })
  it('rejects reports that try to assign releases or another tracker', () => {
    const report = { version: 'v1', sequence: 1, state: 'confirmed' }
    expect(firmwareReportSchema.safeParse(report).success).toBe(true)
    for (const extra of [
      { tracker_id: 'other' },
      { release_id: 'other' },
      { sequence: -1 },
      { state: 'anything' },
    ])
      expect(
        firmwareReportSchema.safeParse({ ...report, ...extra }).success,
      ).toBe(false)
  })
})
