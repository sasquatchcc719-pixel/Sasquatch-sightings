import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { getVoiceSession } from '@/lib/phone-assistant/records'
import { getUserWithRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import Page from './page'

vi.mock('./actions', () => ({ setCoachingExcluded: vi.fn() }))
vi.mock('@/lib/phone-assistant/coaching', async (original) => ({
  ...(await original<typeof import('@/lib/phone-assistant/coaching')>()),
  getCallReview: async () => ({
    excluded: false,
    review: {
      partial: false,
      findings: [
        {
          key: 'repeat_question',
          sequence: 3,
          note: 'Asked for the same detail.',
        },
      ],
    },
  }),
}))
vi.mock('@/lib/auth', () => ({ getUserWithRole: vi.fn() }))
vi.mock('@/supabase/server', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/phone-assistant/records', () => ({ getVoiceSession: vi.fn() }))

const callSid = 'CA' + 'f'.repeat(32)
const deepLink = { searchParams: Promise.resolve({ call: callSid }) }
describe('exact phone transcript', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)
  it('shows an owner the selected call, speaker labels and preview status', async () => {
    vi.mocked(getUserWithRole).mockResolvedValue({
      user: { id: 'test-owner' },
      role: 'owner',
    } as Awaited<ReturnType<typeof getUserWithRole>>)
    vi.mocked(getVoiceSession).mockResolvedValue({
      callSid,
      callerPhone: '+13035550141',
      providerCallId: 'test-provider',
      pilot: true,
      startedAt: '2026-11-18T01:15:00Z',
      endedAt: '2026-11-18T01:18:00Z',
      answeredAt: '2026-11-18T01:15:03Z',
      status: 'ended',
      summary:
        'A caller requested a callback about cleaning three bedrooms before Friday.',
      turns: [
        {
          role: 'user',
          content: 'Could I get three bedrooms cleaned before Friday?',
        },
        {
          sequence: 3,
          role: 'assistant',
          content:
            'I can take a message for Charles to follow up during business hours.',
        },
      ],
    })
    render(await Page(deepLink))
    expect(getVoiceSession).toHaveBeenCalledWith(callSid, expect.anything())
    expect(
      screen.getByRole('heading', { name: 'Transcript' }),
    ).toBeInTheDocument()
    const evidence = screen.getByRole('link', { name: 'View transcript line' })
    expect(evidence).toHaveAttribute('href', '#turn-3')
    expect(document.getElementById('turn-3')).toHaveTextContent(
      'Phone assistant',
    )
    expect(screen.getByText('Caller')).toBeInTheDocument()
    expect(screen.getByText('Phone assistant')).toBeInTheDocument()
    expect(screen.getByText(/Private preview/)).toBeInTheDocument()
  })
  it('rejects a technician before any private call lookup', async () => {
    vi.mocked(getUserWithRole).mockResolvedValue({
      user: { id: 'test-tech' },
      role: 'tech',
    } as Awaited<ReturnType<typeof getUserWithRole>>)
    await expect(Page(deepLink)).rejects.toThrow()
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(getVoiceSession).not.toHaveBeenCalled()
  })
})
