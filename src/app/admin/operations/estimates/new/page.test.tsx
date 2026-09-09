// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ redirect: vi.fn(), db: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))

import NewEstimatePage from './page'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('opens the Book Job estimate form without creating a customer or appointment', () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const redirectSignal = new Error('NEXT_REDIRECT')
  mocks.redirect.mockImplementation(() => {
    throw redirectSignal
  })

  expect(() => NewEstimatePage()).toThrow(redirectSignal)
  expect(mocks.redirect).toHaveBeenCalledTimes(1)
  expect(mocks.redirect).toHaveBeenCalledWith(
    '/admin/operations/new-job?mode=estimate',
  )
  expect(fetch).not.toHaveBeenCalled()
  expect(mocks.db).not.toHaveBeenCalled()
})
