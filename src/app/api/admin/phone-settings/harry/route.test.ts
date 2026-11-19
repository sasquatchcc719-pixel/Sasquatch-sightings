import { NextRequest } from 'next/server'
import { beforeEach, it, expect, vi } from 'vitest'

const { role, read, upsert } = vi.hoisted(() => ({
  role: vi.fn(),
  read: vi.fn(),
  upsert: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getUserWithRole: role }))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ in: () => ({ abortSignal: read }) }),
      upsert,
    }),
  }),
}))
import { PUT, GET } from './route'
import { getHarryAccess } from '@/lib/twilio/harry-access'

const request = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/phone-settings/harry', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('HARRY_VOICE_PUBLIC_READY', '')
  vi.stubEnv('HARRY_VOICE_PROJECT_ID', 'proj_fixture')
  vi.stubEnv('HARRY_VOICE_WEBHOOK_SECRET', 'test-hook-secret')
  vi.stubEnv('OPENAI_API_KEY', 'test-api-key')
  role.mockResolvedValue({ user: { id: 'owner' }, role: 'owner' })
  read.mockResolvedValue({ data: [], error: null })
  upsert.mockResolvedValue({ error: null })
})
it('fails closed on a missing setting, expired preview or storage error', async () => {
  expect(await (await GET()).json()).toMatchObject({
    publicEnabled: false,
    publicReady: false,
    previewPhone: '',
  })
  read.mockResolvedValue({
    data: [
      { key: 'harry_voice_public_enabled', value: true },
      {
        key: 'harry_voice_cell_preview',
        value: { phone: '+17195550123', expiresAt: '2020-01-01' },
      },
    ],
    error: null,
  })
  expect(await getHarryAccess('+17195550123')).toEqual({
    publicEnabled: false,
    preview: false,
  })
  read.mockRejectedValue(new Error('offline'))
  expect(await getHarryAccess('+17195550123')).toEqual({
    publicEnabled: false,
    preview: false,
  })
})
it('rejects enabling public access during pilot and rejects non-admin preview changes', async () => {
  expect(
    (await PUT(request({ action: 'set-public', enabled: true }))).status,
  ).toBe(409)
  expect(
    (await PUT(request({ action: 'start-preview', phone: 'anonymous' })))
      .status,
  ).toBe(400)
  role.mockResolvedValue({ user: { id: 'tech' }, role: 'tech' })
  expect(
    (await PUT(request({ action: 'start-preview', phone: '7195550123' })))
      .status,
  ).toBe(401)
  expect(upsert).not.toHaveBeenCalled()
})
it('arms only the designated number for thirty minutes and can revoke it separately', async () => {
  const before = Date.now()
  expect(
    (await PUT(request({ action: 'start-preview', phone: '(719) 555-0123' })))
      .status,
  ).toBe(200)
  const record = upsert.mock.calls[0][0]
  expect(record).toMatchObject({
    key: 'harry_voice_cell_preview',
    value: { phone: '+17195550123' },
  })
  expect(Date.parse(record.value.expiresAt)).toBeGreaterThanOrEqual(
    before + 30 * 60000,
  )
  expect(Date.parse(record.value.expiresAt)).toBeLessThanOrEqual(
    Date.now() + 30 * 60000,
  )
  read.mockResolvedValue({ data: [record], error: null })
  expect(await getHarryAccess('+17195550123')).toEqual({
    publicEnabled: false,
    preview: true,
  })
  expect(await getHarryAccess('+17195550999')).toEqual({
    publicEnabled: false,
    preview: false,
  })
  await PUT(request({ action: 'stop-preview' }))
  expect(upsert).toHaveBeenLastCalledWith(
    expect.objectContaining({ key: record.key, value: {} }),
    { onConflict: 'key' },
  )
})

it('cannot arm or use a preview before the phone runtime is configured', async () => {
  vi.stubEnv('HARRY_VOICE_WEBHOOK_SECRET', '')
  expect(
    (await PUT(request({ action: 'start-preview', phone: '7195550123' })))
      .status,
  ).toBe(409)
  expect(await getHarryAccess('+17195550123')).toEqual({
    preview: false,
    publicEnabled: false,
  })
  expect(upsert).not.toHaveBeenCalled()
})
