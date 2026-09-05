import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ updateUser: vi.fn(), push: vi.fn() }))
vi.mock('@/supabase/client', () => ({
  createClient: () => ({ auth: { updateUser: mocks.updateUser } }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
import { UpdatePasswordForm } from './update-password-form'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
describe('password recovery during customer onboarding', () => {
  it('completes flagged setup and safely retries a failed flag update', async () => {
    mocks.updateUser.mockResolvedValue({
      data: { user: { app_metadata: { must_change_password: true } } },
      error: null,
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    render(<UpdatePasswordForm />)
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'Recovered-password-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(
      await screen.findByText(
        /Your password was saved, but account setup could not finish/,
      ),
    ).toBeInTheDocument()
    expect(mocks.push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/redirect'))
    expect(mocks.updateUser).toHaveBeenCalledTimes(1)
  })
  it('leaves normal staff password recovery independent of client onboarding', async () => {
    mocks.updateUser.mockResolvedValue({
      data: { user: { app_metadata: {} } },
      error: null,
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<UpdatePasswordForm />)
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'Recovered-password-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/redirect'))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
