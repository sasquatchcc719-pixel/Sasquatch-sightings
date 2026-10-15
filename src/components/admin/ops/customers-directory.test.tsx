import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomersDirectory } from './customers-directory'

function customer(fullName: string) {
  return {
    id: fullName,
    full_name: fullName,
    phone: '+15555550100',
    created_at: '2026-03-12T04:26:08Z',
    ops_service_addresses: [],
  }
}

function response(names: string[], status = 200) {
  return new Response(
    JSON.stringify(
      status === 200
        ? { customers: names.map(customer) }
        : { error: 'Failed to load customers' },
    ),
    { status, headers: { 'Content-Type': 'application/json' } },
  )
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Response>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function debounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250)
  })
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('CustomersDirectory search', () => {
  it('debounces typing and cancels obsolete requests', async () => {
    const pending = deferredResponse()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(['Corey Freebairn']))
      .mockReturnValueOnce(pending.promise)
    const { unmount } = render(<CustomersDirectory />)
    await debounce()
    const initialSignal = fetchMock.mock.calls[0][1]?.signal
    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: 'R' },
    })
    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: 'Re' },
    })
    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: 'Rene' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(initialSignal?.aborted).toBe(true)
    await debounce()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/ops/customers?q=Rene')
    const latestSignal = fetchMock.mock.calls[1][1]?.signal
    unmount()
    expect(latestSignal?.aborted).toBe(true)
  })

  it('keeps the latest results when an older search finishes last', async () => {
    const older = deferredResponse()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(['Corey Freebairn']))
      // Deliberately ignore abort so the component must also discard stale data.
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(response(['Rene Anderson']))

    render(<CustomersDirectory />)
    await debounce()
    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: 'R' },
    })
    await debounce()
    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: 'Rene' },
    })
    await debounce()
    expect(screen.getByText('Rene Anderson')).toBeInTheDocument()

    await act(async () => older.resolve(response(['Corey Freebairn'])))

    expect(screen.getByText('Rene Anderson')).toBeInTheDocument()
    expect(screen.queryByText('Corey Freebairn')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls[2][0]).toBe('/api/admin/ops/customers?q=Rene')
  })

  it('hides unrelated results as soon as the search text changes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response(['Corey Freebairn']),
    )
    render(<CustomersDirectory />)
    await debounce()
    expect(screen.getByText('Corey Freebairn')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: 'Rene' },
    })

    expect(screen.queryByText('Corey Freebairn')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Searching')
    expect(screen.queryByText(/no customers/i)).not.toBeInTheDocument()
  })

  it('lets the user search while the initial directory request is pending', async () => {
    const initial = deferredResponse()
    vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(initial.promise)
      .mockResolvedValueOnce(response(['Rene Anderson']))
    render(<CustomersDirectory />)
    await debounce()
    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: 'Rene' },
    })
    await debounce()
    await act(async () => initial.resolve(response(['Corey Freebairn'])))

    expect(screen.getByText('Rene Anderson')).toBeInTheDocument()
    expect(screen.queryByText('Corey Freebairn')).not.toBeInTheDocument()
  })

  it('keeps the input mounted and focused when clearing a search', async () => {
    const pending = deferredResponse()
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(['Corey Freebairn']))
      .mockResolvedValueOnce(response(['Rene Anderson']))
      .mockReturnValueOnce(pending.promise)
    render(<CustomersDirectory />)
    await debounce()
    const input = screen.getByLabelText(/search/i)
    input.focus()
    fireEvent.change(input, { target: { value: 'Rene' } })
    await debounce()
    fireEvent.change(input, { target: { value: '' } })
    await debounce()

    expect(screen.getByLabelText(/search/i)).toBe(input)
    expect(input).toHaveFocus()
    expect(screen.queryByText('Rene Anderson')).not.toBeInTheDocument()
  })

  it('ignores an outdated error while the current search is still pending', async () => {
    const older = deferredResponse()
    const latest = deferredResponse()
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(['Corey Freebairn']))
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(latest.promise)
    render(<CustomersDirectory />)
    await debounce()
    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: 'R' },
    })
    await debounce()
    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: 'Rene' },
    })
    await debounce()
    await act(async () => older.reject(new Error('Old request failed')))

    expect(screen.queryByText('Old request failed')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Searching')
    await act(async () => latest.resolve(response(['Rene Anderson'])))
    expect(screen.getByText('Rene Anderson')).toBeInTheDocument()
  })

  it('shows a failed search without old results and recovers on the next search', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(['Corey Freebairn']))
      .mockResolvedValueOnce(response([], 500))
      .mockResolvedValueOnce(response(['Rene Anderson']))
    render(<CustomersDirectory />)
    await debounce()
    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: 'Rene' },
    })
    await debounce()

    expect(screen.getByText('Failed to load customers')).toBeInTheDocument()
    expect(screen.queryByText('Corey Freebairn')).not.toBeInTheDocument()
    expect(screen.queryByText(/no customers/i)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: 'Anderson' },
    })
    await debounce()
    expect(screen.getByText('Rene Anderson')).toBeInTheDocument()
    expect(
      screen.queryByText('Failed to load customers'),
    ).not.toBeInTheDocument()
  })

  it('shows an empty result only after the current search completes', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(['Corey Freebairn']))
      .mockResolvedValueOnce(response([]))
    render(<CustomersDirectory />)
    await debounce()
    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: 'Unknown customer' },
    })
    expect(screen.queryByText(/no customers/i)).not.toBeInTheDocument()
    await debounce()
    expect(screen.getByText(/no customers/i)).toBeInTheDocument()
    expect(screen.queryByText('Corey Freebairn')).not.toBeInTheDocument()
  })

  it('refreshes the current search after an edit is saved', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(['Corey Freebairn']))
      .mockResolvedValueOnce(response(['Rene Anderson']))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true })))
      .mockResolvedValueOnce(response(['Rene Anderson Updated']))
    render(<CustomersDirectory />)
    await debounce()
    fireEvent.change(screen.getByLabelText(/search/i), {
      target: { value: 'Rene' },
    })
    await debounce()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    })
    await debounce()

    expect(fetchMock.mock.calls[2][1]?.method).toBe('PATCH')
    expect(fetchMock.mock.calls[3][0]).toBe('/api/admin/ops/customers?q=Rene')
    expect(screen.getByText('Rene Anderson Updated')).toBeInTheDocument()
  })

  it('keeps the edit form available after a failed save', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(['Rene Anderson']))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Failed to update customer' }), {
          status: 500,
        }),
      )
    render(<CustomersDirectory />)
    await debounce()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    })

    expect(screen.getByText('Failed to update customer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
  })
})
