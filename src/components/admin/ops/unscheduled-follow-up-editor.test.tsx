import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UnscheduledFollowUpEditor } from './unscheduled-follow-up-editor'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const followUp = {
  next_follow_up_date: '2026-10-26',
  due: true,
  reviewed_at: null,
  review_note: null,
  updated_at: '2026-10-26T18:00:00Z',
}
it('saves a changed date with its current version and confirms only server success', async () => {
  const next = { ...followUp, next_follow_up_date: '2026-11-01', due: false }
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ follow_up: next }) })
  vi.stubGlobal('fetch', fetcher)
  const onSaved = vi.fn()
  render(
    <UnscheduledFollowUpEditor
      appointmentId="job"
      followUp={followUp}
      onSaved={onSaved}
    />,
  )
  fireEvent.change(screen.getByLabelText(/Next follow-up/), {
    target: { value: next.next_follow_up_date },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save follow-up date' }))
  await screen.findByText('Follow-up date saved.')
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    appointment_id: 'job',
    next_follow_up_date: next.next_follow_up_date,
    expected_updated_at: followUp.updated_at,
  })
  expect(onSaved).toHaveBeenCalledWith(next)
})
it('keeps a save conflict visible and does not report success', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Refresh before saving.' }),
      }),
  )
  const onSaved = vi.fn()
  render(
    <UnscheduledFollowUpEditor
      appointmentId="job"
      followUp={followUp}
      onSaved={onSaved}
    />,
  )
  fireEvent.change(screen.getByLabelText(/Next follow-up/), {
    target: { value: '2026-11-01' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save follow-up date' }))
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Refresh before saving.',
    ),
  )
  expect(onSaved).not.toHaveBeenCalled()
})
