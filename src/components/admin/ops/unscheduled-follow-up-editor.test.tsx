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
    .mockImplementation(async (_url, options) => ({
      ok: true,
      json: async () =>
        options?.method === 'PATCH' ? { follow_up: next } : { events: [] },
    }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Save follow-up' }))
  await screen.findByText('Follow-up saved to history.')
  const saveCall = fetcher.mock.calls.find(
    (call) => call[1]?.method === 'PATCH',
  )!
  expect(JSON.parse(saveCall[1].body)).toEqual({
    appointment_id: 'job',
    next_follow_up_date: next.next_follow_up_date,
    next_follow_up_time: null,
    expected_updated_at: followUp.updated_at,
  })
  expect(onSaved).toHaveBeenCalledWith(next)
})
it('keeps a save conflict visible and does not report success', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(async (_url, options) =>
        options?.method === 'PATCH'
          ? {
              ok: false,
              json: async () => ({ error: 'Refresh before saving.' }),
            }
          : { ok: true, json: async () => ({ events: [] }) },
      ),
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
  fireEvent.click(screen.getByRole('button', { name: 'Save follow-up' }))
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Refresh before saving.',
    ),
  )
  expect(onSaved).not.toHaveBeenCalled()
})

it('shows real history, unknown times, and saves notes and a planned Mountain time', async () => {
  const fetcher = vi.fn().mockImplementation(async (_url, options) => ({
    ok: true,
    json: async () =>
      options?.method === 'PATCH'
        ? {
            follow_up: {
              ...followUp,
              next_follow_up_date: '2099-11-01',
              next_follow_up_time: '14:30',
            },
          }
        : {
            events: [
              {
                id: 'text',
                at: '2026-10-28T20:15:00Z',
                title: 'Outgoing text · delivered',
                detail: 'Can we find a new date?',
                actor: 'Harry',
              },
              {
                id: 'unknown',
                at: null,
                title: 'Customer message received',
                detail: 'Please call Friday',
                actor: null,
              },
            ],
          },
  }))
  vi.stubGlobal('fetch', fetcher)
  render(
    <UnscheduledFollowUpEditor
      appointmentId="job"
      followUp={followUp}
      onSaved={vi.fn()}
    />,
  )
  await screen.findByText('Outgoing text · delivered')
  expect(screen.getByText('Time not recorded')).toBeInTheDocument()
  expect(screen.getByText(/2:15 PM MDT/)).toBeInTheDocument()
  expect(screen.getByText(/time not set/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText(/Next follow-up date/), {
    target: { value: '2099-11-01' },
  })
  fireEvent.change(screen.getByLabelText(/Time \(optional/), {
    target: { value: '14:30' },
  })
  fireEvent.change(screen.getByLabelText('Review / contact outcome'), {
    target: { value: 'Customer requested Friday' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save follow-up' }))
  await screen.findByText('Follow-up saved to history.')
  const saveCall = fetcher.mock.calls.find(
    (call) => call[1]?.method === 'PATCH',
  )!
  expect(JSON.parse(saveCall[1].body)).toMatchObject({
    next_follow_up_time: '14:30',
    review_note: 'Customer requested Friday',
  })
})
it('shows a history loading failure instead of claiming no contact occurred', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'History unavailable' }),
      }),
  )
  render(
    <UnscheduledFollowUpEditor
      appointmentId="job"
      followUp={followUp}
      onSaved={vi.fn()}
    />,
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'History unavailable',
  )
  expect(
    screen.queryByText('No contact or review activity recorded.'),
  ).not.toBeInTheDocument()
})
