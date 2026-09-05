import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ updateUser: vi.fn() }))
vi.mock('@/supabase/client', () => ({
  createClient: () => ({ auth: { updateUser: mocks.updateUser } }),
}))
import { PasswordGate } from './client-portal'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
describe('first portal password', () => {
  it('does not dismiss failed setup and retries completion without resetting the same password', async () => {
    mocks.updateUser.mockResolvedValue({ error: null })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const done = vi.fn()
    render(<PasswordGate onDone={done} />)
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'Safe-password-123' },
    })
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'Safe-password-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
    expect(
      await screen.findByText(
        /Your password was saved, but account setup could not finish/,
      ),
    ).toBeInTheDocument()
    expect(done).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1))
    expect(mocks.updateUser).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
