import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomerBlacklistControl } from './customer-blacklist-control'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CustomerBlacklistControl', () => {
  it('confirms the impact and blacklists a customer with an internal reason', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ entry: { id: 'blacklist-a' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    render(
      <CustomerBlacklistControl
        customerId="customer-a"
        label="Sherry Martin"
        isBlacklisted={false}
        onChanged={onChanged}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Blacklist' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'This blocks calls, texts, outgoing messages, and web bookings.',
    )
    await user.type(
      screen.getByLabelText('Internal reason (optional)'),
      'Do not accept future bookings',
    )
    await user.click(screen.getByRole('button', { name: 'Blacklist customer' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/ops/customers/customer-a/blacklist',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'Do not accept future bookings' }),
      }),
    )
    expect(onChanged).toHaveBeenCalledWith(
      true,
      'Do not accept future bookings',
    )
  })

  it('explains that email suppression remains when removing a blacklist', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    render(
      <CustomerBlacklistControl
        customerId="customer-a"
        label="Sherry Martin"
        isBlacklisted
        reason="Do not accept future bookings"
        onChanged={onChanged}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Blacklisted' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Email suppression stays on until you turn it off separately.',
    )
    await user.click(
      screen.getByRole('button', { name: 'Remove from blacklist' }),
    )

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/ops/customers/customer-a/blacklist',
      { method: 'DELETE' },
    )
    expect(onChanged).toHaveBeenCalledWith(false, null)
  })
})
