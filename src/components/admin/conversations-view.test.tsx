import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('@/components/admin/softphone', () => ({ CallButton: () => null }))
import { ConversationsView } from './conversations-view'
const conversation = {
  id: 'conversation-1',
  phone_number: '+15555550100',
  source: 'inbound',
  lead_id: null,
  messages: [
    {
      role: 'user' as const,
      content: 'Could we find another day?',
      timestamp: '2026-10-26T16:00:00Z',
    },
  ],
  ai_enabled: false,
  ops_customer_id: 'customer-1',
  admin_read_at: null,
  status: 'active' as const,
  created_at: '2026-10-26T16:00:00Z',
  updated_at: '2026-10-26T16:00:00Z',
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('opens the matching saved thread without creating a conversation or sending anything', () => {
  vi.stubGlobal('fetch', mocks.fetch)
  render(
    <ConversationsView
      conversations={[conversation]}
      initialPhone="5555550100"
    />,
  )
  expect(screen.getByPlaceholderText(/reply/i)).toBeVisible()
  expect(screen.getByPlaceholderText(/reply/i)).toHaveValue('')
  expect(mocks.fetch).not.toHaveBeenCalled()
})
it('prefills a new-message draft when there is no saved thread', () => {
  vi.stubGlobal('fetch', mocks.fetch)
  render(<ConversationsView conversations={[]} initialPhone="+15555550101" />)
  expect(screen.getByDisplayValue('+15555550101')).toBeVisible()
  expect(mocks.fetch).not.toHaveBeenCalled()
})
